/**
 * Address validation.
 *
 * Every field here is typed and checked at the boundary rather than trusted, because a checkout
 * form is an external input like any other. The rules are the ones that cost real money when
 * they are wrong: a malformed pincode is a parcel that cannot be rated or delivered, and a
 * missing state silently changes which GST applies.
 *
 * Errors are returned **per field, all at once**. A form that reveals one problem per submit is
 * the same failure as a CSV importer that stops at the first bad row.
 */

/** A postal address, as snapshotted onto an order. Matches `addressSnapshotGroup`. */
export interface AddressSnapshot {
  name: string
  phone: string
  line1: string
  line2: string | null
  city: string
  state: string
  pincode: string
  country: string
}

export type AddressField = keyof AddressSnapshot

export type AddressErrors = Partial<Record<AddressField, string>>

/** Indian postal codes are six digits and never start with zero. */
const PINCODE = /^[1-9]\d{5}$/
/** Ten digits, optionally with +91 or 0 in front. Stored as the bare ten. */
const PHONE = /^(?:\+?91[-\s]?|0)?([6-9]\d{9})$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Reduce a phone number to the ten digits a courier API wants.
 *
 * Customers type `+91 98765 43210`, `098765 43210` and `9876543210` interchangeably; storing
 * whichever form they used makes two identical numbers look like two different customers.
 * Returns null when it is not a valid Indian mobile number.
 */
export function normalisePhone(value: unknown): string | null {
  const match = PHONE.exec(text(value).replace(/[\s-]/g, ''))

  return match?.[1] ?? null
}

/** Pincodes are compared and stored bare, so stray spaces cannot split one into two. */
export function normalisePincode(value: unknown): string | null {
  const cleaned = text(value).replace(/\s/g, '')

  return PINCODE.test(cleaned) ? cleaned : null
}

export interface AddressValidation {
  ok: boolean
  errors: AddressErrors
  /** The cleaned address, safe to store. Present whether or not validation passed. */
  address: AddressSnapshot
}

/**
 * Validate and clean an address from a form body.
 *
 * `line2` and nothing else is optional. `country` defaults to India rather than being required,
 * because a single-country shop asking every customer to type it is friction with no purpose —
 * and the day it ships abroad, this is the one line that changes.
 */
export function validateAddress(input: unknown): AddressValidation {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>

  const line2 = text(source.line2)
  const phone = normalisePhone(source.phone)
  const pincode = normalisePincode(source.pincode)

  const address: AddressSnapshot = {
    name: text(source.name),
    phone: phone ?? text(source.phone),
    line1: text(source.line1),
    line2: line2.length > 0 ? line2 : null,
    city: text(source.city),
    state: text(source.state),
    pincode: pincode ?? text(source.pincode),
    country: text(source.country).length > 0 ? text(source.country) : 'India',
  }

  const errors: AddressErrors = {}

  if (address.name.length < 2) errors.name = 'Please enter the full name for delivery.'
  if (phone === null) errors.phone = 'Please enter a 10-digit Indian mobile number.'
  if (address.line1.length < 4) errors.line1 = 'Please enter the house or flat and street.'
  if (address.city.length < 2) errors.city = 'Please enter the city or town.'
  if (address.state.length < 2) errors.state = 'Please select the state.'
  if (pincode === null) errors.pincode = 'Please enter a valid 6-digit pincode.'

  return { ok: Object.keys(errors).length === 0, errors, address }
}

/** Basic email shape. Deliberately permissive — deliverability is proved by sending, not regex. */
export function normaliseEmail(value: unknown): string | null {
  const cleaned = text(value).toLowerCase()

  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(cleaned) ? cleaned : null
}

/** One-line rendering for an order summary or a confirmation email. */
export function formatAddress(address: AddressSnapshot): string {
  return [address.line1, address.line2, address.city, address.state, address.pincode, address.country]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(', ')
}
