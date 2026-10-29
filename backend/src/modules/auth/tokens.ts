import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { config } from '../../config/env.js';
import { TokenExpiredError, TokenInvalidError } from '../../errors/app-error.js';

/**
 * Access-token signing and verification, and refresh-token generation.
 *
 * Two properties are non-negotiable here.
 *
 * The algorithm, issuer and audience are named on signing and *required* on
 * verification. Verifying without pinning the algorithm is what permits the
 * `alg: none` and algorithm-substitution forgeries, and verifying without
 * issuer and audience means a token minted for another system by the same
 * secret would be accepted.
 *
 * The refresh token is opaque random bytes rather than a JWT, because a JWT is
 * valid by virtue of verifying and therefore cannot be revoked. Only its
 * SHA-256 digest is ever stored.
 */

const ALGORITHM = 'HS256';

const secretKey = new TextEncoder().encode(config.JWT_SECRET);

export interface AccessTokenClaims {
  /** The admin's id. */
  adminId: string;
  email: string;
}

/** Signs an access token carrying the admin's identity. */
export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(claims.adminId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.ACCESS_TOKEN_TTL.seconds)
    .sign(secretKey);
}

/**
 * Verifies an access token.
 *
 * @throws TokenExpiredError when the token is genuine but past its expiry, so
 *   the client can refresh and replay.
 * @throws TokenInvalidError for anything else, so the client signs out. The two
 *   are distinct because the correct client reaction differs.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      // A single-entry allow-list. Anything else, including an unsigned token,
      // fails before the signature is even considered.
      algorithms: [ALGORITHM],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat'],
    });

    const adminId = payload.sub;
    const { email } = payload;
    if (typeof adminId !== 'string' || typeof email !== 'string') {
      throw new TokenInvalidError();
    }

    return { adminId, email };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw new TokenExpiredError();
    }
    if (error instanceof TokenInvalidError) {
      throw error;
    }
    throw new TokenInvalidError();
  }
}

/** Bytes of entropy in a refresh token. 32 is well beyond brute-force reach. */
const REFRESH_TOKEN_BYTES = 32;

export interface GeneratedRefreshToken {
  /** Returned to the client once, in a cookie, and never stored. */
  token: string;
  /** What the database holds. */
  tokenHash: Buffer;
}

/**
 * Mints a refresh token and its digest.
 *
 * A plain SHA-256 rather than bcrypt is correct here: the input is 32 bytes of
 * CSPRNG output, so there is no low-entropy guess space for a slow hash to
 * defend, and a fast digest keeps the rotation path cheap.
 */
export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

/** Digests a refresh token for lookup or storage. */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** A CSRF token the client may read and echo back in a header. */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compares two CSRF tokens without leaking their relationship through timing.
 *
 * Length is compared first because `timingSafeEqual` throws on a length
 * mismatch; that comparison reveals only the length, which is a constant here.
 */
export function csrfTokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
