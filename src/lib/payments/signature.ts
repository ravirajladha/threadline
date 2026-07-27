/**
 * HMAC signatures for webhooks.
 *
 * Both Razorpay and Shiprocket sign with HMAC-SHA256 over the raw request body, so this lives
 * beside the payment adapter rather than inside it — J5's courier webhook uses the same two
 * functions.
 *
 * The comparison is **constant time**. A `===` on two hex strings returns as soon as it finds a
 * differing character, and that timing difference is enough to recover a valid signature one
 * character at a time against an endpoint that will answer as many requests as you like. It is a
 * remote attack on a public URL, not a theoretical one.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Lowercase hex HMAC-SHA256 of `payload` under `secret`. */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/**
 * Compare two hex digests without leaking where they differ.
 *
 * Length is checked first and returns false immediately — that much is public anyway, since a
 * digest's length is fixed by its algorithm, and `timingSafeEqual` throws on a length mismatch
 * rather than returning false.
 */
export function safeCompareHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length || a.length === 0) return false

  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Whether `signature` is a valid HMAC of `payload`.
 *
 * A missing signature is simply invalid. It is worth stating plainly because the tempting
 * shortcut — treating an absent header as "no signature to check, carry on" — turns a verified
 * endpoint into an open one, and it reads as harmless in a diff.
 */
export function verifyHmacSignature(input: {
  secret: string
  payload: string
  signature: string | null | undefined
}): boolean {
  const { secret, payload, signature } = input

  if (typeof signature !== 'string' || signature.length === 0) return false
  if (secret.length === 0) return false

  return safeCompareHex(hmacSha256Hex(secret, payload), signature.trim().toLowerCase())
}
