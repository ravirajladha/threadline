/**
 * Order numbers.
 *
 * The reference a customer reads down the phone. `TL-260727-0042` is the forty-second order of
 * 27 July 2026 — short, unambiguous when spoken, and carrying no personal information.
 *
 * The shape, the parsing and the reasoning behind all of it live in `lib/utils/reference.ts`, which
 * ticket numbers share. This file is the binding: the prefix, and the names the order code calls it
 * by. Support numbers arrived in J7 and a second copy of the parser is how the two would drift.
 */
import {
  buildReference,
  datePrefixOf,
  parseReference,
  type ParsedReference,
} from '@/lib/utils/reference'

export const ORDER_NUMBER_PREFIX = 'TL'

export function buildOrderNumber(input: { date: Date; sequence: number; prefix?: string }): string {
  const { date, sequence, prefix = ORDER_NUMBER_PREFIX } = input

  return buildReference({ date, sequence, prefix })
}

export type ParsedOrderNumber = ParsedReference

/**
 * Parse an order number back out, or null if it is not one.
 *
 * Note this now refuses a *ticket* number, which the older any-prefix pattern accepted — an
 * identifier that parses as two different kinds of thing is a support search that silently looks in
 * the wrong table.
 */
export function parseOrderNumber(value: string): ParsedOrderNumber | null {
  return parseReference(value, ORDER_NUMBER_PREFIX)
}

/** Whether a string looks like one of ours. Used to route a support search. */
export function isOrderNumber(value: string): boolean {
  return parseOrderNumber(value) !== null
}

/** The `TL-260727-` portion, for counting the day's orders so far. */
export function orderDatePrefix(orderNumber: string): string {
  return datePrefixOf(orderNumber)
}
