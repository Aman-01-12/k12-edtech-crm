import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { config } from '../../config/env.js';
import { TokenExpiredError, TokenInvalidError } from '../../errors/app-error.js';

const ALGORITHM = 'HS256';
const REFRESH_TOKEN_BYTES = 32;

const secretKey = new TextEncoder().encode(config.JWT_SECRET);

export interface AccessTokenClaims {
  adminId: string;
  email: string;
}

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
 * Pinning the algorithm, issuer and audience is what closes the `alg: none` and
 * algorithm-substitution forgeries, and rejects a token minted for another
 * system with the same secret.
 *
 * @throws TokenExpiredError when genuine but expired, so the client refreshes.
 * @throws TokenInvalidError otherwise, so the client signs out.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
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

export interface GeneratedRefreshToken {
  /** Returned to the client once, in a cookie, and never stored. */
  token: string;
  tokenHash: Buffer;
}

/**
 * Opaque random bytes, not a JWT, because a JWT is valid by virtue of verifying
 * and so cannot be revoked. A plain SHA-256 is right for the digest: the input
 * is 32 bytes of CSPRNG output, so there is no guess space to slow down.
 */
export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Length is checked first because `timingSafeEqual` throws on a mismatch. */
export function csrfTokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
