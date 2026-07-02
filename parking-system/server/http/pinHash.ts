import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// scrypt PIN hashing for staff_sessions.pin_hash. Stored format:
//   scrypt$<saltHex>$<hashHex>
// The plaintext PIN is never stored or logged — only this derived hash. Compare is
// constant-time (timingSafeEqual), matching the convention in jobAuth.ts.

const KEYLEN = 32
const SALT_BYTES = 16

export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(pin, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  if (salt.length === 0 || expected.length !== KEYLEN) return false
  const derived = scryptSync(pin, salt, KEYLEN)
  return timingSafeEqual(derived, expected)
}
