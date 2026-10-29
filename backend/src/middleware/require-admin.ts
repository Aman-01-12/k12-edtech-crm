import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { TokenInvalidError } from '../errors/app-error.js';
import { ACCESS_TOKEN_COOKIE, readCookie } from '../modules/auth/cookies.js';
import { findLiveAdminById } from '../modules/auth/admin.repository.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAdmin`. Present only on authenticated routes. */
    admin?: AuthenticatedAdminPrincipal;
  }
}

export interface AuthenticatedAdminPrincipal {
  adminId: string;
  email: string;
  fullName: string;
}

function toUnixSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

/**
 * Verifies the token, then re-reads the account.
 *
 * The second check is what makes deactivation immediate: an access token stays
 * cryptographically valid until it expires, so without it a deactivated admin
 * would keep working for the token's remaining lifetime.
 *
 * Authorization comes only from the verified `sub` claim.
 */
export const requireAdmin: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  void (async () => {
    try {
      const token = readCookie(
        req.cookies as Record<string, unknown> | undefined,
        ACCESS_TOKEN_COOKIE,
      );
      if (token === undefined) {
        // Invalid, not expired: there is nothing to refresh.
        throw new TokenInvalidError('You are not signed in.');
      }

      const claims = await verifyAccessToken(token);

      const admin = await findLiveAdminById(claims.adminId);
      if (admin === undefined) {
        throw new TokenInvalidError('Your account is no longer active.');
      }

      // Compared at whole-second resolution, which is all `iat` carries. A
      // token minted in the same second as the cutoff is allowed, because the
      // replacement session a password change issues is minted in that second
      // and must survive its own cutoff. Any token from an earlier second,
      // which is every pre-existing session, is refused.
      const cutoff = admin.sessions_invalidated_at;
      if (cutoff !== null && toUnixSeconds(claims.issuedAt) < toUnixSeconds(cutoff)) {
        throw new TokenInvalidError('Your session ended because the password was changed.');
      }

      req.admin = { adminId: admin.id, email: admin.email, fullName: admin.full_name };
      next();
    } catch (error) {
      next(error);
    }
  })();
};
