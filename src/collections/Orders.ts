import type { CollectionConfig } from 'payload'

import { denyAll, ownScopedRead, staffWrite } from '@/access'
import { bookShipmentEndpoint, fulfilOrderEndpoint } from '@/endpoints/fulfilment'
import { addressSnapshotGroup, moneyField, serverOwned } from './fields'
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@/types'

/**
 * An order — the durable record of a sale.
 *
 * Two rules shape this collection. First, **nothing here is created through the API**:
 * `create` is denied to every role, because an order is only ever built server-side from a
 * cart the server has re-priced (OWASP A04 — the client is never the authority on a total).
 * Second, **nothing here is deleted**: an order is cancelled or refunded, never removed, so
 * the ledger stays reconcilable.
 *
 * The money fields must reconcile exactly: subtotal + shipping + taxTotal − discount −
 * loyaltyDiscount = grandTotal, to the paise. That invariant is enforced and tested in
 * `src/lib/pricing` at J4; here the fields simply exist as integer paise.
 */
export const Orders: CollectionConfig = {
  slug: 'orders',
  access: {
    read: ownScopedRead({ resource: 'orders', ownerField: 'customer' }),
    create: denyAll,
    update: staffWrite('orders'),
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'status', 'paymentStatus', 'grandTotal', 'placedAt'],
    group: 'Commerce',
  },
  endpoints: [fulfilOrderEndpoint, bookShipmentEndpoint],
  fields: [
    {
      name: 'fulfilmentActions',
      type: 'ui',
      admin: {
        components: { Field: '@/components/admin/FulfilmentActions#FulfilmentActions' },
        // Nothing to fulfil until the order exists.
        condition: (data) => Boolean(data?.id),
      },
    },
    {
      name: 'orderNumber',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: serverOwned.readOnly,
        description: 'Human-readable reference the customer quotes to support.',
      },
    },
    { name: 'customer', type: 'relationship', relationTo: 'customers', index: true },
    {
      name: 'email',
      type: 'email',
      required: true,
      admin: { description: 'Captured at checkout — guests have no customer record.' },
    },
    { name: 'phone', type: 'text' },
    addressSnapshotGroup('shippingAddress'),
    addressSnapshotGroup('billingAddress'),
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: ORDER_STATUSES.map((value) => ({ label: value, value })),
      admin: {
        position: 'sidebar',
        description: 'Transitions are validated in lib/orders. Illegal jumps are rejected.',
      },
    },
    {
      name: 'paymentMethod',
      type: 'select',
      required: true,
      defaultValue: 'razorpay',
      options: PAYMENT_METHODS.map((value) => ({ label: value, value })),
    },
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: PAYMENT_STATUSES.map((value) => ({ label: value, value })),
    },
    { name: 'razorpayOrderId', type: 'text', index: true, admin: { readOnly: serverOwned.readOnly } },
    { name: 'razorpayPaymentId', type: 'text', index: true, admin: { readOnly: serverOwned.readOnly } },
    {
      type: 'collapsible',
      label: 'Totals',
      admin: { description: 'All integer paise. Computed server-side; these fields are a record, not an input.' },
      fields: [
        moneyField('subtotal', { required: true }),
        moneyField('shipping', { required: true }),
        moneyField('taxTotal', { required: true }),
        moneyField('discount', { required: true, description: 'From the coupon.' }),
        moneyField('loyaltyDiscount', { required: true, description: 'From redeemed points.' }),
        moneyField('grandTotal', { required: true, description: 'What was actually charged.' }),
      ],
    },
    {
      name: 'taxBreakup',
      type: 'group',
      admin: { description: 'CGST+SGST within the seller’s state, IGST across states. Never both.' },
      fields: [moneyField('cgst'), moneyField('sgst'), moneyField('igst')],
    },
    { name: 'coupon', type: 'relationship', relationTo: 'coupons' },
    {
      type: 'collapsible',
      label: 'Fulfilment',
      fields: [
        { name: 'shiprocketOrderId', type: 'text', index: true },
        { name: 'awbCode', type: 'text', index: true, admin: { description: 'Air waybill — the tracking number.' } },
        { name: 'courier', type: 'text' },
      ],
    },
    { name: 'placedAt', type: 'date', index: true },
    { name: 'deliveredAt', type: 'date' },
    { name: 'cancelledAt', type: 'date' },
  ],
}
