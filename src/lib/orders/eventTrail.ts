/**
 * Recovering provider event ids from an order's audit trail.
 *
 * Both integrations that write to `orderEvents` need the same thing: "have I already applied this
 * provider event?" answered from the trail itself rather than from a second table that could disagree
 * with it. Payments needed it first; tracking is the second caller, which is what moved this out of
 * `paymentApply.ts` and into a file neither of them owns (CLAUDE.md §3).
 *
 * The id travels inside `orderEvents.note`, which is a short human-readable string like
 * `payment.captured stub_evt_abc` or `OUT FOR DELIVERY stub_trk_def`. That is a deliberate trade: the
 * alternative is a dedicated column and a migration, and the trail is already the one record of what
 * happened. The cost is that reading an id back is parsing, so the parsing is kept here, in one
 * place, with tests — rather than inlined as a regex in each caller.
 *
 * **Prefixes are a parameter, not a constant.** A tracking id is `stub_trk_…` and a payment id is
 * `stub_evt_…`; a single hard-coded pattern would have silently failed to match tracking ids, and
 * every replayed delivery scan would have been treated as new.
 */

/** Characters an event id is allowed to contain. Anything else marks its edges. */
const ID_BODY = /[^A-Za-z0-9_-]/g

/** Payment event ids, from `PaymentEvent.id`. Longest prefix first — see `hasPrefix`. */
export const PAYMENT_EVENT_ID_PREFIXES: readonly string[] = Object.freeze(['stub_evt_', 'evt_'])

/** Tracking event ids, from `TrackingEvent.id`. */
export const TRACKING_EVENT_ID_PREFIXES: readonly string[] = Object.freeze(['stub_trk_', 'trk_'])

/**
 * Strip anything that cannot be part of an id from a token's edges.
 *
 * A note ending in a full stop would otherwise yield `stub_evt_abc.`, which matches no id and makes a
 * replay look new.
 */
function trimToId(token: string): string {
  return token.replace(new RegExp(`^${ID_BODY.source}+`), '').replace(new RegExp(`${ID_BODY.source}+$`), '')
}

/**
 * Whether a token starts with one of the prefixes and has something after it.
 *
 * The "something after" matters: a bare `evt_` is not an id, and treating it as one would make two
 * unrelated events look like the same replay.
 */
function idPrefixOf(token: string, prefixes: readonly string[]): string | null {
  for (const prefix of prefixes) {
    if (token.startsWith(prefix) && token.length > prefix.length) return prefix
  }

  return null
}

/**
 * Every provider event id recorded in these notes.
 *
 * Splits on whitespace rather than running a regex over the whole string. Both work, but tokenising
 * is predictable: a regex alternation over prefixes has to be ordered longest-first or `evt_` matches
 * inside `stub_evt_abc` and returns the wrong id, and that is a trap for whoever adds the third
 * prefix rather than a property of the code.
 */
export function eventIdsFrom(
  notes: readonly (string | null | undefined)[],
  prefixes: readonly string[],
): string[] {
  const ids: string[] = []

  for (const note of notes) {
    if (typeof note !== 'string') continue

    for (const rawToken of note.split(/\s+/)) {
      const token = trimToId(rawToken)
      if (token.length > 0 && idPrefixOf(token, prefixes) !== null) ids.push(token)
    }
  }

  return ids
}
