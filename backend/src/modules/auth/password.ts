import bcrypt from 'bcrypt';
import { PASSWORD_MAX_BYTES, utf8ByteLength } from '@k12/contracts';
import { config } from '../../config/env.js';

/**
 * Password hashing and verification.
 *
 * bcrypt is required by the brief. OWASP now prefers Argon2id, which is
 * memory-hard and therefore much more expensive to attack on GPUs; that
 * trade-off is accepted here because the requirement is explicit. The cost
 * factor is configuration-enforced at 12 or above, which is OWASP's floor for
 * bcrypt, and the input length is bounded for the reason below.
 */

/**
 * bcrypt hashes at most the first 72 bytes of its input and silently discards
 * the rest, so without this guard two passwords sharing a 72-byte prefix would
 * be interchangeable. Rejecting rather than truncating is what makes the stored
 * hash correspond to the whole password.
 */
function assertHashableLength(password: string): void {
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    throw new RangeError(
      `Password exceeds bcrypt's ${PASSWORD_MAX_BYTES}-byte input limit and would be silently truncated.`,
    );
  }
}

/** Hashes a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  assertHashableLength(password);
  return bcrypt.hash(password, config.BCRYPT_COST);
}

/**
 * A hash of a value no caller knows, used to spend the same work on a sign-in
 * attempt for an address that does not exist.
 *
 * Without it, an unknown address returns in microseconds while a known one
 * takes as long as bcrypt needs, and the difference is measurable enough to
 * enumerate accounts. Generated once at module load so the cost is paid at
 * startup rather than on the first probe.
 */
const dummyHashPromise: Promise<string> = bcrypt.hash(
  'account-absent-timing-equaliser',
  config.BCRYPT_COST,
);

/**
 * Verifies a password against a stored hash.
 *
 * @param password - the candidate, as supplied by the caller.
 * @param hash - the stored bcrypt digest.
 * @returns whether the password matches. An over-length password returns false
 *   rather than throwing, because at sign-in it is a wrong credential rather
 *   than a programming error.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    return false;
  }
  return bcrypt.compare(password, hash);
}

/**
 * Spends a password comparison's worth of work and always fails.
 *
 * Called on the no-such-account path so that the response time of a sign-in
 * attempt does not disclose whether the address is registered.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  await bcrypt.compare(password, await dummyHashPromise);
  return false;
}
