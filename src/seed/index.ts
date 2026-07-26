/**
 * Demo catalog seed.
 *
 * Builds a small but *complete* store — a category tree, the size and colour vocabularies, six
 * products with their full size × colour variant matrix, opening stock for every variant, one
 * staff account per role and a demo customer. Complete matters more than large: J2's bulk
 * variant tools and J3's filters are only exercisable against a catalog that actually has
 * multiple colours in multiple sizes, some of them sold out.
 *
 * Two guarantees:
 * - **Idempotent.** Everything is matched on a unique field first. Running it twice changes
 *   nothing, so it is safe to re-run after a schema change.
 * - **Fictional.** This repo is public (CLAUDE.md §2) — no real brand, person or address
 *   appears here, and staff passwords come from the environment, never from this file.
 *
 * Run with `npm run seed`.
 */
// Must come first — it populates process.env before payload.config is evaluated.
import './env'

import { getPayload, type Payload } from 'payload'

import config from '../payload.config'
import { createPayloadLedgerPort } from '../lib/inventory/payloadLedger'
import { syncVariantStock } from '../lib/inventory/syncStock'
import { STAFF_ROLES, type StaffRole } from '../types'

// --- Guards -----------------------------------------------------------------

if (process.env.NODE_ENV === 'production') {
  throw new Error('The seed script refuses to run against a production database.')
}

const SEED_PASSWORD = process.env.SEED_PASSWORD
if (!SEED_PASSWORD || SEED_PASSWORD.length < 12) {
  throw new Error(
    'Set SEED_PASSWORD in .env.local to at least 12 characters. Seeded accounts must not share a password committed to a public repo.',
  )
}

// --- Idempotent upsert ------------------------------------------------------

type Slug = Parameters<Payload['create']>[0]['collection']

/**
 * Row ids in this project are Postgres serials. Payload types them as `string | number` to
 * cover UUID setups, so this narrows once, loudly, instead of casting at each of the dozen
 * places a seeded id is used as a relationship value.
 */
function asId(id: string | number): number {
  if (typeof id !== 'number') throw new TypeError(`Expected a numeric row id, received ${typeof id}`)
  return id
}

/**
 * Create `data` unless a document already matches `where`. Returns the id either way, so the
 * caller can wire up relationships without caring whether this run created the row.
 */
async function ensure(
  payload: Payload,
  collection: Slug,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<number> {
  const existing = await payload.find({
    collection,
    where: where as never,
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const found = existing.docs[0]
  if (found) return asId(found.id)

  const created = await payload.create({
    collection,
    data: data as never,
    depth: 0,
    overrideAccess: true,
  })

  return asId(created.id)
}

// --- Fixture data -----------------------------------------------------------

const COLOURS = [
  { name: 'Midnight Navy', hex: '#1b2a4a', sortOrder: 1 },
  { name: 'Bone White', hex: '#f2ede4', sortOrder: 2 },
  { name: 'Olive', hex: '#5a6448', sortOrder: 3 },
  { name: 'Charcoal', hex: '#3a3a3c', sortOrder: 4 },
  { name: 'Clay', hex: '#b1705a', sortOrder: 5 },
  { name: 'Sand', hex: '#cdbb9e', sortOrder: 6 },
]

const TOPWEAR_SIZES = ['S', 'M', 'L', 'XL', 'XXL']
const BOTTOMWEAR_SIZES = ['30', '32', '34', '36']

/** Money is integer paise everywhere — ₹1,899 is 189900. */
const PRODUCTS = [
  {
    title: 'Kestrel Oxford Shirt',
    category: 'shirts',
    mrp: 189900,
    taxRatePct: 12,
    fabric: '100% combed cotton oxford, 140 GSM',
    careInstructions: 'Machine wash cold, hang dry, warm iron',
    fitNotes: 'Regular fit through the chest. Size down for a slimmer silhouette.',
    colours: ['Midnight Navy', 'Bone White', 'Olive'],
    featured: true,
  },
  {
    title: 'Harrow Linen Shirt',
    category: 'shirts',
    mrp: 224900,
    taxRatePct: 12,
    fabric: '55% linen, 45% cotton, 130 GSM',
    careInstructions: 'Gentle wash, dry flat, iron while damp',
    fitNotes: 'Relaxed fit. Linen softens and relaxes further after two or three washes.',
    colours: ['Bone White', 'Sand', 'Clay'],
    featured: false,
  },
  {
    title: 'Everyday Heavy Tee',
    category: 't-shirts',
    mrp: 79900,
    taxRatePct: 5,
    fabric: '100% cotton jersey, 220 GSM',
    careInstructions: 'Machine wash cold, do not tumble dry',
    fitNotes: 'True to size with a boxy shoulder. Runs slightly short in the body.',
    colours: ['Charcoal', 'Bone White', 'Olive'],
    featured: true,
  },
  {
    title: 'Pima Crew Tee',
    category: 't-shirts',
    mrp: 99900,
    taxRatePct: 5,
    fabric: '100% Pima cotton, 160 GSM',
    careInstructions: 'Machine wash cold, hang dry',
    fitNotes: 'Slim through the body. Size up if you prefer a looser fit.',
    colours: ['Midnight Navy', 'Sand', 'Clay'],
    featured: false,
  },
  {
    title: 'Foundry Slim Chinos',
    category: 'chinos',
    mrp: 219900,
    taxRatePct: 12,
    fabric: '98% cotton twill, 2% elastane',
    careInstructions: 'Machine wash cold, warm iron, do not bleach',
    fitNotes: 'Slim through the thigh with a slight taper. Waist runs true.',
    colours: ['Olive', 'Charcoal'],
    featured: true,
  },
  {
    title: 'Cove Pleated Trousers',
    category: 'chinos',
    mrp: 259900,
    taxRatePct: 12,
    fabric: '100% cotton twill, 280 GSM',
    careInstructions: 'Dry clean or gentle machine wash',
    fitNotes: 'Wide leg with a single forward pleat. Sits at the natural waist.',
    colours: ['Sand', 'Midnight Navy'],
    featured: false,
  },
]

/**
 * Opening stock, varied on purpose. The zero is not an oversight: J3's storefront has to render
 * a sold-out size as visible-but-disabled, and that is untestable against a catalog where
 * everything is in stock.
 */
const OPENING_STOCK = [12, 8, 20, 5, 0, 15, 3, 9]

const STAFF: Array<{ role: StaffRole; name: string }> = [
  { role: 'super_admin', name: 'Asha Menon' },
  { role: 'catalog_manager', name: 'Rohan Desai' },
  { role: 'order_manager', name: 'Priya Nair' },
  { role: 'support_agent', name: 'Imran Sheikh' },
  { role: 'marketing', name: 'Tara Bose' },
]

// --- Seed -------------------------------------------------------------------

async function seed(): Promise<void> {
  const payload = await getPayload({ config })

  payload.logger.info('Seeding demo catalog…')

  // Store settings. Every tunable number lives here rather than in code.
  await payload.updateGlobal({
    slug: 'settings',
    data: {
      freeShippingThreshold: 149900,
      flatShippingRate: 7900,
      codEnabled: true,
      codFee: 4900,
      returnWindowDays: 7,
      returnShippingPaidBy: 'store',
      companyState: 'Karnataka',
      supportEmail: 'support@threadline.example',
      supportPhone: '+91 80 4000 0000',
      whatsappOptInDefault: false,
      loyaltyEnabled: true,
      maintenanceMode: false,
    },
    overrideAccess: true,
  })

  // Colours.
  const colourIds = new Map<string, number>()
  for (const colour of COLOURS) {
    const id = await ensure(payload, 'colours', { name: { equals: colour.name } }, { ...colour, isActive: true })
    colourIds.set(colour.name, id)
  }

  // Sizes, in wearable order — sortOrder is what stops the pills rendering L, M, S, XL.
  const sizeIds = new Map<string, number>()
  for (const [index, label] of TOPWEAR_SIZES.entries()) {
    const id = await ensure(
      payload,
      'sizes',
      { and: [{ label: { equals: label } }, { group: { equals: 'topwear' } }] },
      { label, group: 'topwear', sortOrder: index + 1, isActive: true },
    )
    sizeIds.set(`topwear:${label}`, id)
  }
  for (const [index, label] of BOTTOMWEAR_SIZES.entries()) {
    const id = await ensure(
      payload,
      'sizes',
      { and: [{ label: { equals: label } }, { group: { equals: 'bottomwear' } }] },
      { label, group: 'bottomwear', sortOrder: index + 1, isActive: true },
    )
    sizeIds.set(`bottomwear:${label}`, id)
  }

  // Size chart, attached to the topwear categories.
  const topwearChartId = await ensure(
    payload,
    'sizeCharts',
    { title: { equals: 'Men’s Topwear' } },
    {
      title: 'Men’s Topwear',
      group: 'topwear',
      notes: 'Measurements are of the garment laid flat, not of the body.',
      measurements: [
        { sizeLabel: 'S', chestIn: 38, waistIn: 34, lengthIn: 27, shoulderIn: 17 },
        { sizeLabel: 'M', chestIn: 40, waistIn: 36, lengthIn: 28, shoulderIn: 17.5 },
        { sizeLabel: 'L', chestIn: 42, waistIn: 38, lengthIn: 29, shoulderIn: 18 },
        { sizeLabel: 'XL', chestIn: 44, waistIn: 40, lengthIn: 30, shoulderIn: 18.5 },
        { sizeLabel: 'XXL', chestIn: 46, waistIn: 42, lengthIn: 31, shoulderIn: 19 },
      ],
    },
  )

  // Category tree: Men → Shirts / T-Shirts / Chinos.
  const menId = await ensure(
    payload,
    'categories',
    { slug: { equals: 'men' } },
    { title: 'Men', slug: 'men', sizeGroup: 'topwear', sortOrder: 1, isActive: true },
  )

  const categorySpecs = [
    { title: 'Shirts', slug: 'shirts', sizeGroup: 'topwear', sizeChart: topwearChartId },
    { title: 'T-Shirts', slug: 't-shirts', sizeGroup: 'topwear', sizeChart: topwearChartId },
    { title: 'Chinos', slug: 'chinos', sizeGroup: 'bottomwear' },
  ]

  const categoryIds = new Map<string, number>()
  for (const [index, spec] of categorySpecs.entries()) {
    const id = await ensure(
      payload,
      'categories',
      { slug: { equals: spec.slug } },
      { ...spec, parent: menId, sortOrder: index + 1, isActive: true },
    )
    categoryIds.set(spec.slug, id)
  }

  // Products, and the full size × colour matrix beneath each.
  let variantCount = 0
  let stockIndex = 0

  for (const spec of PRODUCTS) {
    const categoryId = categoryIds.get(spec.category)
    if (categoryId === undefined) throw new Error(`Unknown seed category ${spec.category}`)

    const slug = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const productId = await ensure(
      payload,
      'products',
      { slug: { equals: slug } },
      {
        title: spec.title,
        slug,
        category: categoryId,
        mrp: spec.mrp,
        taxRatePct: spec.taxRatePct,
        fabric: spec.fabric,
        careInstructions: spec.careInstructions,
        fitNotes: spec.fitNotes,
        status: 'active',
        featured: spec.featured,
      },
    )

    const sizeGroup = spec.category === 'chinos' ? 'bottomwear' : 'topwear'
    const labels = sizeGroup === 'bottomwear' ? BOTTOMWEAR_SIZES : TOPWEAR_SIZES

    for (const colourName of spec.colours) {
      for (const label of labels) {
        const colourId = colourIds.get(colourName)
        const sizeId = sizeIds.get(`${sizeGroup}:${label}`)
        if (colourId === undefined || sizeId === undefined) {
          throw new Error(`Missing seed reference for ${colourName} / ${label}`)
        }

        const existing = await payload.find({
          collection: 'variants',
          where: {
            and: [
              { product: { equals: productId } },
              { size: { equals: sizeId } },
              { colour: { equals: colourId } },
            ],
          },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })

        if (existing.docs.length > 0) continue

        const variant = await payload.create({
          collection: 'variants',
          // `sku` is required on the generated type but supplied by the beforeValidate hook on
          // Variants, so it is deliberately absent here — the hook builds it from the product,
          // colour and size, which is exactly the behaviour worth exercising in the seed.
          data: {
            product: productId,
            size: sizeId,
            colour: colourId,
            price: spec.mrp,
            weightGrams: sizeGroup === 'bottomwear' ? 420 : 260,
            isActive: true,
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        variantCount += 1

        const qty = OPENING_STOCK[stockIndex % OPENING_STOCK.length] ?? 10
        stockIndex += 1

        // Stock only ever enters through the ledger, seed data included. The afterChange hook
        // recalculates variants.stockQty from it.
        if (qty > 0) {
          await payload.create({
            collection: 'stockMovements',
            data: { variant: asId(variant.id), type: 'in', qty, reason: 'Opening stock (seed)' },
            depth: 0,
            overrideAccess: true,
          })
        }
      }
    }
  }

  // Reconcile every variant against its ledger.
  //
  // The collection hook already does this on each movement, so on a clean run this is a no-op.
  // It runs anyway because a seed should converge: if a variant's cached figure ever drifts —
  // from an interrupted run, or from a hook that was broken when the rows were written — a
  // re-seed repairs it rather than leaving a wrong number in place.
  const allVariants = await payload.find({
    collection: 'variants',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const ledger = createPayloadLedgerPort(payload)
  let inStockCount = 0
  for (const variant of allVariants.docs) {
    if ((await syncVariantStock(ledger, variant.id)) > 0) inStockCount += 1
  }

  // One staff account per role, so the role matrix can be exercised by logging in.
  for (const member of STAFF) {
    await ensure(
      payload,
      'users',
      { email: { equals: `${member.role}@threadline.example` } },
      {
        email: `${member.role}@threadline.example`,
        password: SEED_PASSWORD,
        name: member.name,
        role: member.role,
        isActive: true,
      },
    )
  }

  // A demo customer with an address, so checkout and tax have something to work against.
  const customerId = await ensure(
    payload,
    'customers',
    { email: { equals: 'demo@threadline.example' } },
    {
      email: 'demo@threadline.example',
      password: SEED_PASSWORD,
      name: 'Devi Krishnan',
      phone: '9800000000',
      whatsappOptIn: true,
      emailVerified: true,
    },
  )

  await ensure(
    payload,
    'addresses',
    { and: [{ customer: { equals: customerId } }, { label: { equals: 'Home' } }] },
    {
      customer: customerId,
      label: 'Home',
      name: 'Devi Krishnan',
      phone: '9800000000',
      line1: '12 Sampige Road',
      line2: 'Malleswaram',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560003',
      country: 'India',
      isDefault: true,
    },
  )

  payload.logger.info(
    `Seed complete — ${PRODUCTS.length} products, ${variantCount} new variants, ` +
      `${inStockCount}/${allVariants.docs.length} variants in stock, ${STAFF_ROLES.length} staff accounts.`,
  )
}

await seed()
process.exit(0)
