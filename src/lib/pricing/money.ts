/**
 * Money — an immutable value object holding an integer number of paise.
 *
 * Every price, tax, discount and total in this codebase is a `Money`. Floating point
 * rupees are never used for arithmetic: `0.1 + 0.2 !== 0.3` becomes a real accounting
 * error once it reaches an invoice.
 *
 * The class is immutable — every operation returns a new instance, so a Money can be
 * shared freely without defensive copying.
 */
export class Money {
  /** Amount in paise. 1 rupee = 100 paise. */
  private readonly paise: number

  private constructor(paise: number) {
    if (!Number.isInteger(paise)) {
      throw new RangeError(`Money must be a whole number of paise, received ${paise}`)
    }
    if (!Number.isSafeInteger(paise)) {
      throw new RangeError(`Money amount is outside the safe integer range: ${paise}`)
    }
    this.paise = paise
  }

  // --- Construction ---------------------------------------------------------

  static fromPaise(paise: number): Money {
    return new Money(paise)
  }

  /**
   * Build from rupees. Rounds to the nearest paise (half away from zero) so that
   * user-entered decimals like 499.995 cannot smuggle sub-paise precision in.
   */
  static fromRupees(rupees: number): Money {
    if (!Number.isFinite(rupees)) {
      throw new RangeError(`Money.fromRupees requires a finite number, received ${rupees}`)
    }
    const scaled = rupees * 100
    const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
    return new Money(rounded)
  }

  static zero(): Money {
    return new Money(0)
  }

  /** Sum of any number of amounts; empty input is zero. */
  static sum(amounts: readonly Money[]): Money {
    return amounts.reduce<Money>((total, amount) => total.add(amount), Money.zero())
  }

  // --- Arithmetic -----------------------------------------------------------

  add(other: Money): Money {
    return new Money(this.paise + other.paise)
  }

  subtract(other: Money): Money {
    return new Money(this.paise - other.paise)
  }

  /** Multiply by a whole quantity — line totals, never fractional. */
  multiply(quantity: number): Money {
    if (!Number.isInteger(quantity)) {
      throw new RangeError(`Quantity must be a whole number, received ${quantity}`)
    }
    return new Money(this.paise * quantity)
  }

  /**
   * A percentage of this amount, rounded to the nearest paise.
   * Used for GST and percentage coupons.
   */
  percentage(percent: number): Money {
    if (!Number.isFinite(percent)) {
      throw new RangeError(`Percentage must be a finite number, received ${percent}`)
    }
    const raw = (this.paise * percent) / 100
    const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw)
    return new Money(rounded)
  }

  /** Never drops below zero — discounts must not create negative totals. */
  clampToZero(): Money {
    return this.paise < 0 ? Money.zero() : this
  }

  /** The smaller of the two — caps a discount at the value it applies to. */
  min(other: Money): Money {
    return this.paise <= other.paise ? this : other
  }

  max(other: Money): Money {
    return this.paise >= other.paise ? this : other
  }

  // --- Comparison -----------------------------------------------------------

  equals(other: Money): boolean {
    return this.paise === other.paise
  }

  isZero(): boolean {
    return this.paise === 0
  }

  isNegative(): boolean {
    return this.paise < 0
  }

  greaterThan(other: Money): boolean {
    return this.paise > other.paise
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.paise >= other.paise
  }

  lessThan(other: Money): boolean {
    return this.paise < other.paise
  }

  // --- Output ---------------------------------------------------------------

  /** Raw paise — the only form ever written to the database. */
  toPaise(): number {
    return this.paise
  }

  /** Decimal rupees. Display and third-party APIs only; never fed back into arithmetic. */
  toRupees(): number {
    return this.paise / 100
  }

  /** Localised display string, e.g. "₹1,299.00". */
  format(locale = 'en-IN', currency = 'INR'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(this.toRupees())
  }

  toString(): string {
    return this.format()
  }

  toJSON(): number {
    return this.paise
  }
}
