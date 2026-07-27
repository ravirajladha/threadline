/**
 * The Payload-backed implementation of `CartPort`.
 *
 * Every mutation follows the same three steps, and the order is the point:
 *
 * 1. **Load** the stored cart for this session — a bare list of variant ids and quantities.
 * 2. **Change** it with a pure function from `lines.ts`, which clamps and merges.
 * 3. **Re-read** every variant from the database and rebuild the view from scratch.
 *
 * Step 3 is what makes the client's numbers irrelevant (OWASP A04). Nothing a browser sends is
 * ever a price, a total or a stock figure; the only things it gets to choose are *which* variant
 * and *how many*, and even the quantity is clamped against live availability on the way through.
 * A tampered request can therefore ask for something silly, but it cannot buy at the wrong price.
 *
 * **The session id is the capability.** A guest cart has no owner, so possession of the cookie is
 * the entire authorisation story — which is why `session.ts` makes it 256 bits of CSPRNG output
 * and httpOnly. Every method here takes a session id and scopes its query to it; there is no
 * method that takes a cart id, because an id in a URL is exactly the enumerable handle this design
 * avoids. Once a customer signs in, `mergeGuestCart` binds the cart to them as well.
 */
import type { Payload, Where } from 'payload'

import type { Cart, Category, Colour, Coupon, Product, Size, Variant } from '@/payload-types'
import { toImageViews } from '@/lib/catalog/gallery'
import { availableQty } from '@/lib/catalog/variantView'
import type { CouponRule } from '@/lib/pricing/coupon'
import type { PricingSettings } from '@/lib/pricing/totals'
import { loadPricingSettings } from '@/lib/settings/storeSettings'
import { numericId, optionalNumericId } from '@/lib/utils/ids'
import { buildPricedCart } from './cartView'
import { addLine, normaliseQty, removeLine, setLineQty } from './lines'
import { mergeCoupon, mergeItems } from './merge'
import { cartExpiry } from './session'
import {
  CART_TTL_DAYS,
  type CartItem,
  type CartMutation,
  type CartPort,
  type CartPricingOptions,
  type CartVariantSnapshot,
  type CartView,
  type PricedCartResult,
} from './types'

/** A variant read deeply enough to describe a cart line without a second query per row. */
type CartVariant = Omit<Variant, 'size' | 'colour' | 'product'> & {
  size: number | Size
  colour: number | Colour
  product: number | Product
}

function idOf(value: number | string | { id: number | string } | null | undefined): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value

  return value.id
}

function isDoc<T extends { id: number | string }>(value: unknown): value is T {
  return typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)
}

/**
 * Flatten a variant into the snapshot the pure cart layer expects.
 *
 * Returns null when the relationships did not populate. A half-built line — no size, no colour, no
 * price — is worse than an honest "no longer available", which `cartView.ts` renders from the
 * absence of a snapshot and which the customer can act on by removing the line.
 */
function toCartSnapshot(variant: CartVariant): CartVariantSnapshot | null {
  const size = isDoc<Size>(variant.size) ? variant.size : null
  const colour = isDoc<Colour>(variant.colour) ? variant.colour : null
  const product = isDoc<Product>(variant.product) ? variant.product : null

  if (size === null || colour === null || product === null) return null

  // The variant's own price wins, and the product MRP is the fallback — the same rule the catalog
  // uses. Zero is a real price to nobody, so it falls back too.
  const unitPricePaise = typeof variant.price === 'number' && variant.price > 0 ? variant.price : product.mrp

  const images = toImageViews(product.gallery, product.title)
  const image = images.find((candidate) => candidate.colourId === colour.id) ?? images[0] ?? null

  const productActive = product.status === 'active'
  const category = idOf(product.category)

  return {
    variantId: variant.id,
    sku: variant.sku,
    productId: product.id,
    productTitle: product.title,
    productSlug: product.slug,
    categoryId: category,
    categorySlug: isDoc<Category>(product.category) ? product.category.slug : null,
    sizeLabel: size.label,
    colourName: colour.name,
    colourHex: colour.hex,
    image,
    unitPricePaise,
    taxRatePct: product.taxRatePct,
    availableQty: availableQty(variant.stockQty, variant.reservedQty),
    isPurchasable: variant.isActive !== false && productActive,
  }
}

/** Flatten a coupon document into the rule the pricing layer evaluates. */
export function toCouponRule(coupon: Coupon): CouponRule {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    // Null and zero are different instructions — "no minimum" against "a minimum of nothing".
    minCartValuePaise: typeof coupon.minCartValue === 'number' ? coupon.minCartValue : null,
    maxDiscountPaise: typeof coupon.maxDiscount === 'number' ? coupon.maxDiscount : null,
    limitTotal: typeof coupon.limitTotal === 'number' ? coupon.limitTotal : null,
    limitPerUser: typeof coupon.limitPerUser === 'number' ? coupon.limitPerUser : null,
    usedCount: typeof coupon.usedCount === 'number' ? coupon.usedCount : 0,
    startsAt: coupon.startsAt ?? null,
    endsAt: coupon.endsAt ?? null,
    appliesTo: coupon.appliesTo,
    categoryIds: (coupon.categories ?? []).map((entry) => idOf(entry)).filter((id): id is number | string => id !== null),
    productIds: (coupon.products ?? []).map((entry) => idOf(entry)).filter((id): id is number | string => id !== null),
    isActive: coupon.isActive !== false,
    stackable: coupon.stackable === true,
  }
}

/** The stored items, normalised out of Payload's array field. */
function toCartItems(cart: Cart | null): CartItem[] {
  if (cart === null) return []

  return (cart.items ?? [])
    .map((row) => {
      const variantId = idOf(row.variant)
      if (variantId === null) return null

      return {
        variantId,
        qty: typeof row.qty === 'number' ? row.qty : 0,
        priceAtAddPaise: typeof row.priceAtAdd === 'number' ? row.priceAtAdd : 0,
      }
    })
    .filter((item): item is CartItem => item !== null && item.qty > 0)
}

export interface PayloadCartOptions {
  payload: Payload
  /** Resolved once per request and reused, rather than read per mutation. */
  settings?: PricingSettings
}

export function createPayloadCartPort(options: PayloadCartOptions): CartPort {
  const { payload } = options

  async function settingsFor(): Promise<PricingSettings> {
    return options.settings ?? (await loadPricingSettings(payload))
  }

  async function findCart(sessionId: string): Promise<Cart | null> {
    const { docs } = await payload.find({
      collection: 'carts',
      where: { sessionId: { equals: sessionId } } satisfies Where,
      // Deep enough to reach product, size, colour and the gallery's media in one read.
      depth: 2,
      limit: 1,
      pagination: false,
      overrideAccess: true,
    })

    return (docs[0] as Cart | undefined) ?? null
  }

  async function createCart(sessionId: string): Promise<Cart> {
    return (await payload.create({
      collection: 'carts',
      data: {
        sessionId,
        items: [],
        expiresAt: cartExpiry(new Date(), CART_TTL_DAYS).toISOString(),
      },
      depth: 2,
      overrideAccess: true,
    })) as Cart
  }

  /**
   * Read every variant a cart references.
   *
   * One query for the whole cart rather than one per line: a five-line cart is five round trips
   * done naively, on a page that is already waiting on settings and a coupon.
   */
  async function snapshotsFor(items: readonly CartItem[]): Promise<CartVariantSnapshot[]> {
    if (items.length === 0) return []

    const { docs } = await payload.find({
      collection: 'variants',
      where: { id: { in: items.map((item) => item.variantId) } } satisfies Where,
      depth: 2,
      pagination: false,
      overrideAccess: true,
    })

    return (docs as CartVariant[])
      .map((variant) => toCartSnapshot(variant))
      .filter((snapshot): snapshot is CartVariantSnapshot => snapshot !== null)
  }

  async function couponFor(cart: Cart | null): Promise<Coupon | null> {
    if (cart === null) return null

    const coupon = cart.coupon
    if (coupon === null || coupon === undefined) return null
    if (isDoc<Coupon>(coupon)) return coupon

    try {
      return (await payload.findByID({
        collection: 'coupons',
        id: coupon,
        depth: 0,
        overrideAccess: true,
      })) as Coupon
    } catch {
      // A coupon deleted since it was applied simply stops applying. Failing the whole cart read
      // over a missing discount would lock the customer out of checking out at all.
      return null
    }
  }

  /**
   * How many times this customer has already redeemed this code.
   *
   * Counted from placed orders rather than a counter on the customer, because an order is the
   * durable record of a redemption and a counter is a second thing to keep in step with it.
   */
  async function couponUsage(couponId: number | string, customerId: number | string | null): Promise<number> {
    if (customerId === null) return 0

    const { totalDocs } = await payload.count({
      collection: 'orders',
      where: {
        and: [{ coupon: { equals: couponId } }, { customer: { equals: customerId } }],
      } satisfies Where,
      overrideAccess: true,
    })

    return totalDocs
  }

  async function loyaltyBalance(customerId: number | string | null): Promise<number> {
    if (customerId === null) return 0

    try {
      const customer = await payload.findByID({
        collection: 'customers',
        id: customerId,
        depth: 0,
        overrideAccess: true,
      })

      return typeof customer.loyaltyPoints === 'number' ? customer.loyaltyPoints : 0
    } catch {
      return 0
    }
  }

  /** Build the view for a cart that has already been loaded. The single read path. */
  async function pricedOf(cart: Cart | null, options: CartPricingOptions = {}): Promise<PricedCartResult> {
    const items = toCartItems(cart)
    const customerId = idOf(cart?.customer ?? null)

    const [settings, snapshots, couponDoc] = await Promise.all([
      settingsFor(),
      snapshotsFor(items),
      couponFor(cart),
    ])

    const coupon = couponDoc === null ? null : toCouponRule(couponDoc)

    const [usage, balance] = await Promise.all([
      coupon === null ? Promise.resolve(0) : couponUsage(coupon.id, customerId),
      loyaltyBalance(customerId),
    ])

    const priced = buildPricedCart({
      id: cart?.id ?? null,
      items,
      snapshots,
      settings,
      coupon,
      couponUsageByCustomer: usage,
      loyaltyBalance: balance,
      options,
    })

    return {
      view: priced.view,
      pricing: priced.pricing,
      cartId: cart?.id ?? null,
      customerId,
      // The rule that actually priced the cart, not merely the one stored on the row. A code
      // that stopped qualifying is dropped by the pricing layer, and the order must not then
      // record a redemption of a discount it never received.
      couponId: priced.pricing.coupon === null ? null : (couponDoc?.id ?? null),
    }
  }

  async function viewOf(cart: Cart | null, options: CartPricingOptions = {}): Promise<CartView> {
    return (await pricedOf(cart, options)).view
  }

  /** Persist a new item list and return the rebuilt view. Also refreshes the sweep deadline. */
  async function saveItems(cart: Cart, items: readonly CartItem[], options: CartPricingOptions): Promise<CartView> {
    const updated = (await payload.update({
      collection: 'carts',
      id: cart.id,
      data: {
        items: items.map((item) => ({
          variant: numericId(item.variantId),
          qty: item.qty,
          priceAtAdd: item.priceAtAddPaise,
        })),
        // Touching the cart keeps it alive: a shopper still editing it has not abandoned it.
        expiresAt: cartExpiry(new Date(), CART_TTL_DAYS).toISOString(),
      },
      depth: 2,
      overrideAccess: true,
    })) as Cart

    return viewOf(updated, options)
  }

  /**
   * The live availability and price for one variant, for a mutation that is about to clamp to it.
   *
   * Returns null when the variant cannot be bought at all, which the caller turns into a no-op —
   * an add of something unpurchasable must not put a line in the cart that the customer then has
   * to discover and remove.
   */
  async function purchasableSnapshot(variantId: number | string): Promise<CartVariantSnapshot | null> {
    const [snapshot] = await snapshotsFor([{ variantId, qty: 1, priceAtAddPaise: 0 }])

    if (snapshot === undefined || !snapshot.isPurchasable) return null

    return snapshot
  }

  return {
    async getCart(sessionId, options = {}): Promise<CartView> {
      const existing = await findCart(sessionId)

      if (existing === null && options.create === true) {
        return viewOf(await createCart(sessionId), options)
      }

      return viewOf(existing, options)
    },

    async getPricedCart(sessionId, options = {}): Promise<PricedCartResult> {
      return pricedOf(await findCart(sessionId), options)
    },

    async addItem(sessionId, mutation: CartMutation, options = {}): Promise<CartView> {
      const snapshot = await purchasableSnapshot(mutation.variantId)
      const cart = (await findCart(sessionId)) ?? (await createCart(sessionId))

      if (snapshot === null) return viewOf(cart, options)

      const items = addLine(toCartItems(cart), {
        variantId: mutation.variantId,
        qty: normaliseQty(mutation.qty),
        // The server's price and the server's ceiling. The request supplied neither.
        pricePaise: snapshot.unitPricePaise,
        available: snapshot.availableQty,
      })

      return saveItems(cart, items, options)
    },

    async setItemQty(sessionId, mutation: CartMutation, options = {}): Promise<CartView> {
      const cart = await findCart(sessionId)
      if (cart === null) return viewOf(null, options)

      const qty = normaliseQty(mutation.qty)

      // Setting a line to zero is how the stepper removes it — the same intent, one control.
      if (qty <= 0) {
        return saveItems(cart, removeLine(toCartItems(cart), mutation.variantId), options)
      }

      const snapshot = await purchasableSnapshot(mutation.variantId)
      if (snapshot === null) return viewOf(cart, options)

      const items = setLineQty(toCartItems(cart), {
        variantId: mutation.variantId,
        qty,
        available: snapshot.availableQty,
      })

      return saveItems(cart, items, options)
    },

    async removeItem(sessionId, variantId, options = {}): Promise<CartView> {
      const cart = await findCart(sessionId)
      if (cart === null) return viewOf(null, options)

      return saveItems(cart, removeLine(toCartItems(cart), variantId), options)
    },

    async applyCoupon(sessionId, code, options = {}): Promise<CartView> {
      const cart = await findCart(sessionId)
      if (cart === null) return viewOf(null, options)

      const normalised = typeof code === 'string' ? code.trim().toUpperCase() : ''

      const { docs } = await payload.find({
        collection: 'coupons',
        where: { code: { equals: normalised } } satisfies Where,
        depth: 0,
        limit: 1,
        pagination: false,
        overrideAccess: true,
      })

      const found = (docs[0] as Coupon | undefined) ?? null

      // An unknown code is stored as "no coupon" and reported through the pricing layer's
      // rejection, so the customer is told it did not apply rather than being shown a silent
      // no-change. Codes are never listed publicly (OWASP: no enumeration surface).
      const updated = (await payload.update({
        collection: 'carts',
        id: cart.id,
        data: { coupon: found === null ? null : found.id },
        depth: 2,
        overrideAccess: true,
      })) as Cart

      if (found === null) {
        // A code nobody recognises is stored as "no coupon", so the rejection has to be added
        // back here: with `coupon: null` the pricing layer reports nothing, which would leave the
        // customer looking at an unchanged total and no explanation.
        const view = await viewOf(updated, options)

        return {
          ...view,
          couponCode: null,
          couponRejection: 'unknown_code',
          pricing: { ...view.pricing, couponCode: null, couponRejection: 'unknown_code' },
        }
      }

      return viewOf(updated, options)
    },

    async removeCoupon(sessionId, options = {}): Promise<CartView> {
      const cart = await findCart(sessionId)
      if (cart === null) return viewOf(null, options)

      const updated = (await payload.update({
        collection: 'carts',
        id: cart.id,
        data: { coupon: null },
        depth: 2,
        overrideAccess: true,
      })) as Cart

      return viewOf(updated, options)
    },

    /**
     * Adopt a guest cart into the customer's own.
     *
     * The guest cart is deleted rather than reassigned, so a cookie that survives on a shared
     * machine cannot be replayed to read what is now a signed-in customer's cart.
     */
    async mergeGuestCart(sessionId, customerId): Promise<CartView> {
      const guest = await findCart(sessionId)

      const { docs } = await payload.find({
        collection: 'carts',
        where: { customer: { equals: customerId } } satisfies Where,
        depth: 2,
        limit: 1,
        pagination: false,
        overrideAccess: true,
      })

      const owned = (docs[0] as Cart | undefined) ?? null

      if (guest === null && owned === null) return viewOf(null)

      // Nothing to merge: simply bind this session's cart to the customer.
      if (owned === null && guest !== null) {
        const bound = (await payload.update({
          collection: 'carts',
          id: guest.id,
          data: { customer: numericId(customerId) },
          depth: 2,
          overrideAccess: true,
        })) as Cart

        return viewOf(bound)
      }

      if (owned !== null && guest === null) return viewOf(owned)
      if (owned === null || guest === null) return viewOf(null)

      const guestItems = toCartItems(guest)
      const ownedItems = toCartItems(owned)

      // Availability is read for the union of both carts, because the merge clamps summed
      // quantities: two carts each holding the last unit must come out of this holding one.
      const snapshots = await snapshotsFor([...ownedItems, ...guestItems])
      const availableBy = new Map(snapshots.map((snapshot) => [String(snapshot.variantId), snapshot]))

      const merged = mergeItems(ownedItems, guestItems, (variantId) => {
        const snapshot = availableBy.get(String(variantId))

        return snapshot === undefined || !snapshot.isPurchasable ? 0 : snapshot.availableQty
      })

      const coupon = mergeCoupon(idOf(owned.coupon ?? null), idOf(guest.coupon ?? null))

      const updated = (await payload.update({
        collection: 'carts',
        id: owned.id,
        data: {
          sessionId,
          coupon: optionalNumericId(coupon),
          items: merged.map((item) => ({
            variant: numericId(item.variantId),
            qty: item.qty,
            priceAtAdd: item.priceAtAddPaise,
          })),
          expiresAt: cartExpiry(new Date(), CART_TTL_DAYS).toISOString(),
        },
        depth: 2,
        overrideAccess: true,
      })) as Cart

      await payload.delete({ collection: 'carts', id: guest.id, overrideAccess: true })

      return viewOf(updated)
    },
  }
}
