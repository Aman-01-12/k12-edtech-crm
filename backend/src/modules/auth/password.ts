import bcrypt from 'bcrypt';
import { PASSWORD_MAX_BYTES, utf8ByteLength } from '@k12/contracts';
import { config } from '../../config/env.js';

/**
 * bcrypt hashes only the first 72 bytes of its input and discards the rest, so
 * an over-length password is rejected rather than silently truncated.
 */
function assertHashableLength(password: string): void {
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    throw new RangeError(
      `Password exceeds bcrypt's ${PASSWORD_MAX_BYTES}-byte input limit and would be silently truncated.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertHashableLength(password);
  return bcrypt.hash(password, config.BCRYPT_COST);
}

/** Hash of a value no caller knows, for the unknown-account timing path. */
const dummyHashPromise: Promise<string> = bcrypt.hash(
  'account-absent-timing-equaliser',
  config.BCRYPT_COST,
);

/**
 * @returns whether the password matches. An over-length password returns false
 *   rather than throwing: at sign-in that is a wrong credential, not a bug.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    return false;
  }
  return bcrypt.compare(password, hash);
}

/**
 * Spends a comparison's worth of work and always fails, so the response time of
 * a sign-in attempt does not disclose whether the address is registered.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  await bcrypt.compare(password, await dummyHashPromise);
  return false;
}
