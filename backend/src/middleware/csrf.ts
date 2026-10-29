import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CsrfTokenInvalidError } from '../errors/app-error.js';
import { CSRF_TOKEN_COOKIE, readCookie } from '../modules/auth/cookies.js';
import { csrfTokensMatch } from '../modules/auth/tokens.js';

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit guard on state-changing requests.
 *
 * `SameSite` already withholds the session cookies from a cross-site POST, so
 * this is a second layer: `SameSite` is a browser policy, and the application
 * should still be the thing in the way if a browser treats it loosely. An
 * attacker's page can make the browser send the cookie but cannot read it to
 * build the matching header.
 */
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

  if (!csrfTokensMatch(cookieToken, headerToken)) {
    req.log.info('Rejected a state-changing request on a CSRF token mismatch');
    next(new CsrfTokenInvalidError());
    return;
  }

  next();
};
