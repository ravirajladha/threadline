'use client'
// Interactive: a fully controlled field set. The parent owns the address; this renders it.

import { useId } from 'react'
import type { AddressErrors, AddressField, AddressSnapshot } from '@/lib/orders/address'

/**
 * The delivery (or billing) address field set.
 *
 * Controlled rather than uncontrolled because two things outside it need the same value: the
 * "billing is the same as delivery" toggle, and the fact that the destination **state decides
 * the GST split** — so the checkout page has to know it as the customer types, not on submit.
 *
 * Nothing is validated here. `validateAddress` in `src/lib/orders/address.ts` is the one set of
 * rules, the parent runs it to decide whether to submit, and **the server runs it again on the
 * request body** — the errors this component renders are a convenience, never a gate. A form
 * that was the only thing standing between a customer and a malformed address would be a form
 * anyone could skip with `curl`.
 */

/**
 * States and union territories, in the spelling GST filings use.
 *
 * A free-text state would quietly break `taxJurisdiction`, which compares this against the
 * seller's state by name: "Karnataka" and "karnataka " are the difference between CGST+SGST and
 * IGST on every order. If a second surface ever needs this list it moves to `src/lib/orders/`.
 */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const

function FieldError({ id, message }: { id: string; message: string | undefined }): React.ReactElement | null {
  if (message === undefined) return null

  return (
    <p id={id} className="text-danger text-sm">
      {message}
    </p>
  )
}

export interface AddressFormProps {
  legend: string
  value: AddressSnapshot
  /** Per-field messages from `validateAddress`. Empty until the customer has tried to submit. */
  errors: AddressErrors
  onChange: (address: AddressSnapshot) => void
  disabled?: boolean
}

export function AddressForm({
  legend,
  value,
  errors,
  onChange,
  disabled = false,
}: AddressFormProps): React.ReactElement {
  const prefix = useId()
  const fieldId = (field: AddressField): string => `${prefix}-${field}`
  const errorId = (field: AddressField): string => `${prefix}-${field}-error`

  /** One typed update path. A `Partial` rather than a computed key, so a typo is a compile error. */
  const patch = (change: Partial<AddressSnapshot>): void => {
    onChange({ ...value, ...change })
  }

  const describedBy = (field: AddressField): string | undefined =>
    errors[field] !== undefined ? errorId(field) : undefined

  const inputClasses = (field: AddressField): string =>
    `bg-surface text-fg placeholder:text-fg-subtle w-full rounded-control border px-3 py-2 text-sm disabled:opacity-60 ${
      errors[field] !== undefined ? 'border-danger' : 'border-border'
    }`

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <legend className="text-fg mb-2 text-base font-medium">{legend}</legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId('name')} className="text-fg text-sm font-medium">
            Full name
          </label>
          <input
            id={fieldId('name')}
            name="name"
            type="text"
            autoComplete="name"
            value={value.name}
            onChange={(event) => patch({ name: event.target.value })}
            aria-invalid={errors.name !== undefined}
            aria-describedby={describedBy('name')}
            className={inputClasses('name')}
          />
          <FieldError id={errorId('name')} message={errors.name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId('phone')} className="text-fg text-sm font-medium">
            Mobile number
          </label>
          <input
            id={fieldId('phone')}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-digit mobile number"
            value={value.phone}
            onChange={(event) => patch({ phone: event.target.value })}
            aria-invalid={errors.phone !== undefined}
            aria-describedby={describedBy('phone')}
            className={inputClasses('phone')}
          />
          <FieldError id={errorId('phone')} message={errors.phone} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId('line1')} className="text-fg text-sm font-medium">
          Flat, house number and street
        </label>
        <input
          id={fieldId('line1')}
          name="line1"
          type="text"
          autoComplete="address-line1"
          value={value.line1}
          onChange={(event) => patch({ line1: event.target.value })}
          aria-invalid={errors.line1 !== undefined}
          aria-describedby={describedBy('line1')}
          className={inputClasses('line1')}
        />
        <FieldError id={errorId('line1')} message={errors.line1} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId('line2')} className="text-fg text-sm font-medium">
          Area, landmark <span className="text-fg-subtle font-normal">(optional)</span>
        </label>
        {/* The only optional field, and an empty one is stored as null rather than "" so a
            snapshot never carries a blank line onto a printed shipping label. */}
        <input
          id={fieldId('line2')}
          name="line2"
          type="text"
          autoComplete="address-line2"
          value={value.line2 ?? ''}
          onChange={(event) => patch({ line2: event.target.value.length > 0 ? event.target.value : null })}
          className={inputClasses('line2')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId('pincode')} className="text-fg text-sm font-medium">
            Pincode
          </label>
          <input
            id={fieldId('pincode')}
            name="pincode"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            value={value.pincode}
            onChange={(event) => patch({ pincode: event.target.value })}
            aria-invalid={errors.pincode !== undefined}
            aria-describedby={describedBy('pincode')}
            className={inputClasses('pincode')}
          />
          <FieldError id={errorId('pincode')} message={errors.pincode} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId('city')} className="text-fg text-sm font-medium">
            City or town
          </label>
          <input
            id={fieldId('city')}
            name="city"
            type="text"
            autoComplete="address-level2"
            value={value.city}
            onChange={(event) => patch({ city: event.target.value })}
            aria-invalid={errors.city !== undefined}
            aria-describedby={describedBy('city')}
            className={inputClasses('city')}
          />
          <FieldError id={errorId('city')} message={errors.city} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId('state')} className="text-fg text-sm font-medium">
            State
          </label>
          <select
            id={fieldId('state')}
            name="state"
            autoComplete="address-level1"
            value={value.state}
            onChange={(event) => patch({ state: event.target.value })}
            aria-invalid={errors.state !== undefined}
            aria-describedby={describedBy('state')}
            className={inputClasses('state')}
          >
            <option value="">Select a state</option>
            {INDIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          <FieldError id={errorId('state')} message={errors.state} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId('country')} className="text-fg text-sm font-medium">
            Country
          </label>
          {/* Read-only rather than absent: the snapshot carries a country, and showing the one
              being stored is more honest than a hidden input the customer cannot see. */}
          <input
            id={fieldId('country')}
            name="country"
            type="text"
            readOnly
            value={value.country}
            className="border-border bg-surface-raised text-fg-muted w-full rounded-control border px-3 py-2 text-sm"
          />
        </div>
      </div>
    </fieldset>
  )
}
