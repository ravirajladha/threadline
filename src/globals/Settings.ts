import type { GlobalConfig } from 'payload'

import { staffWrite } from '@/access'
import { moneyField } from '@/collections/fields'

/**
 * Store settings — the single home for every number the owner might want to change.
 *
 * CLAUDE.md §3 states the rule this global exists to enforce: *anything an admin might ever
 * change is config or DB, never a literal in code*. A free-shipping threshold hard-coded as
 * `if (subtotal >= 99900)` is a deploy every time marketing has an idea; here it is a field.
 *
 * Publicly readable because the storefront needs the shipping threshold and the return window
 * to render honest copy. Nothing secret belongs in this global — secrets are environment
 * variables (OWASP A02).
 */
export const Settings: GlobalConfig = {
  slug: 'settings',
  access: {
    read: () => true,
    update: staffWrite('settings'),
  },
  admin: {
    group: 'Configuration',
    description: 'Store-wide rules. Changing these takes effect immediately, with no deploy.',
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Shipping',
          fields: [
            moneyField('freeShippingThreshold', {
              required: true,
              description: 'Carts at or above this ship free.',
            }),
            moneyField('flatShippingRate', {
              required: true,
              description: 'Charged when the cart is below the threshold.',
            }),
            {
              name: 'codEnabled',
              type: 'checkbox',
              defaultValue: true,
              label: 'Cash on delivery available',
            },
            moneyField('codFee', { description: 'Extra charge for paying on delivery.' }),
          ],
        },
        {
          label: 'Returns',
          fields: [
            {
              name: 'returnWindowDays',
              type: 'number',
              required: true,
              defaultValue: 7,
              min: 0,
              admin: { description: 'Days after delivery in which a return may be raised.' },
            },
            {
              name: 'returnShippingPaidBy',
              type: 'select',
              required: true,
              defaultValue: 'store',
              options: [
                { label: 'The store', value: 'store' },
                { label: 'The customer', value: 'customer' },
              ],
            },
          ],
        },
        {
          label: 'Tax',
          fields: [
            {
              name: 'companyState',
              type: 'text',
              required: true,
              defaultValue: 'Karnataka',
              admin: {
                description:
                  'The seller’s state. An order shipping here is CGST+SGST; anywhere else is IGST.',
              },
            },
            { name: 'gstin', type: 'text', admin: { description: 'Printed on invoices.' } },
          ],
        },
        {
          label: 'Support',
          fields: [
            { name: 'supportEmail', type: 'email', required: true },
            { name: 'supportPhone', type: 'text' },
            {
              name: 'whatsappOptInDefault',
              type: 'checkbox',
              defaultValue: false,
              admin: { description: 'Whether the opt-in box is pre-ticked at checkout.' },
            },
          ],
        },
        {
          label: 'Loyalty',
          fields: [
            { name: 'loyaltyEnabled', type: 'checkbox', defaultValue: true },
            {
              name: 'loyaltyEarnPerRupee',
              type: 'number',
              defaultValue: 1,
              min: 0,
              admin: { description: 'Points awarded per ₹1 of subtotal, on delivery.' },
            },
            {
              name: 'loyaltyMaxRedeemPct',
              type: 'number',
              defaultValue: 10,
              min: 0,
              max: 100,
              admin: { description: 'The most of a cart that points may pay for.' },
            },
            {
              name: 'loyaltyMinRedeem',
              type: 'number',
              defaultValue: 50,
              min: 0,
              admin: { description: 'Fewest points that may be redeemed at once.' },
            },
          ],
        },
        {
          label: 'Store',
          fields: [
            {
              name: 'maintenanceMode',
              type: 'checkbox',
              defaultValue: false,
              admin: { description: 'Takes the storefront offline. The admin stays reachable.' },
            },
          ],
        },
      ],
    },
  ],
}
