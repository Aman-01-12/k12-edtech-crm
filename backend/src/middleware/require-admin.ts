import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { TokenInvalidError } from '../errors/app-error.js';
import { ACCESS_TOKEN_COOKIE, readCookie } from '../modules/auth/cookies.js';
import { findLiveAdminById } from '../modules/auth/admin.repository.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

/**
 * Protected-route guard.
 *
 * Two checks, both required.
 *
 * The token must verify, with the algorithm, issuer and audience pinned. That
 * establishes the request carries a credential this system issued.
 *
 * The admin must then still resolve as live. This second check is what makes
 * deactivation immediate: an access token stays cryptographically valid until
 * it expires, so without re-reading the account a deactivated admin would keep
 * working for up to the token's remaining lifetime. It costs one indexed
 * primary-key lookup per request, which is the right price for that property.
 *
 * Authorization is decided only from the verified `sub` claim. No header, query
 * parameter or body field influences it.
 */

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
        // Absent is reported as invalid rather than expired: there is nothing
        // to refresh, so the client must sign in.
        throw new TokenInvalidError('You are not signed in.');
      }

      // Throws TokenExpiredError or TokenInvalidError, which the error
      // middleware maps to the two distinct codes the client branches on.
      const claims = await verifyAccessToken(token);

      const admin = await findLiveAdminById(claims.adminId);
      if (admin === undefined) {
        throw new TokenInvalidError('Your account is no longer active.');
      }

      req.admin = {
        adminId: admin.id,
        email: admin.email,
        fullName: admin.full_name,
      };

      next();
    } catch (error) {
      next(error);
    }
  })();
};
