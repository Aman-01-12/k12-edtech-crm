import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CsrfTokenInvalidError } from '../errors/app-error.js';
import { CSRF_TOKEN_COOKIE, readCookie } from '../modules/auth/cookies.js';
import { csrfTokensMatch } from '../modules/auth/tokens.js';

/**
 * Double-submit CSRF guard for state-changing requests.
 *
 * `SameSite` on the session cookies already withholds them from a cross-site
 * POST, so this is a second layer rather than the only one. It exists because
 * `SameSite` is a browser policy and this is an application policy: the day a
 * browser ships a regression, or a user runs one that treats `SameSite`
 * loosely, the application should still be the thing standing in the way.
 *
 * The pattern: a token is issued in a cookie the page can read, and the page
 * echoes it in a header. An attacker's page can cause the browser to *send*
 * the cookie but cannot *read* it to construct the matching header, because
 * reading it is blocked by the same-origin policy.
 */

export const CSRF_HEADER = 'x-csrf-token';

export const requireCsrfToken: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const cookieToken = readCookie(
    req.cookies as Record<string, unknown> | undefined,
    CSRF_TOKEN_COOKIE,
  );
  const headerToken = req.get(CSRF_HEADER);

  if (cookieToken === undefined || headerToken === undefined || headerToken.length === 0) {
    next(new CsrfTokenInvalidError());
    return;
  }

  // Timing-safe, and length-guarded first because the underlying comparison
  // throws on a length mismatch.
  if (!csrfTokensMatch(cookieToken, headerToken)) {
    req.log.info('Rejected a state-changing request on a CSRF token mismatch');
    next(new CsrfTokenInvalidError());
    return;
  }

  next();
};
