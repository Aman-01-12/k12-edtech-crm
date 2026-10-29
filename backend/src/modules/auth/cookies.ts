import type { CookieOptions, Response } from 'express';
import { config } from '../../config/env.js';

/**
 * Session cookie management.
 *
 * All three cookies are set and cleared here so their attributes cannot drift
 * apart. A refresh cookie that lost its `Path` scope, or an access cookie that
 * lost `HttpOnly`, would be a silent downgrade of the session design.
 */

export const ACCESS_TOKEN_COOKIE = 'k12_access';
export const REFRESH_TOKEN_COOKIE = 'k12_refresh';
export const CSRF_TOKEN_COOKIE = 'k12_csrf';

/**
 * The refresh cookie is scoped to the only paths that consume it.
 *
 * Narrowing the path means an XSS on a dashboard page cannot cause the browser
 * to attach the refresh token to a request it forges to some other endpoint,
 * because the browser will not send it there at all.
 */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * `Secure` is omitted outside production because local development is served
 * over plain HTTP and a `Secure` cookie would simply never be stored, which
 * presents as a broken sign-in rather than as a configuration problem.
 */
function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * Sets the access token cookie.
 *
 * `SameSite=Lax` rather than `Strict`: Lax still withholds the cookie from a
 * cross-site POST, which is the CSRF case, but does send it on an ordinary
 * top-level navigation, so following a link to a dashboard route does not
 * appear as a signed-out session.
 */
export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: config.ACCESS_TOKEN_TTL.seconds * 1000,
  });
}

/**
 * Sets the refresh token cookie.
 *
 * `SameSite=Strict` is affordable here because this cookie is only ever sent by
 * the application's own fetch to the refresh and sign-out endpoints, never by a
 * navigation.
 */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.REFRESH_TOKEN_TTL.seconds * 1000,
  });
}

/**
 * Sets the CSRF token cookie.
 *
 * Deliberately **not** `HttpOnly`: the double-submit pattern requires the page
 * to read this value and echo it in a header. That is safe because the cookie
 * is not a credential; it proves only that the request came from a page served
 * by this origin, which an attacker's page cannot read.
 */
export function setCsrfTokenCookie(res: Response, token: string): void {
  res.cookie(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: config.REFRESH_TOKEN_TTL.seconds * 1000,
  });
}

/**
 * Clears all three cookies.
 *
 * Each is cleared with the same attributes it was set with, because a browser
 * matches a clear by name, path and domain. Clearing the refresh cookie at `/`
 * would leave the one scoped to `/api/v1/auth` in place, so sign-out would
 * appear to work and the session would survive.
 */
export function clearSessionCookies(res: Response): void {
  const base = baseCookieOptions();

  res.clearCookie(ACCESS_TOKEN_COOKIE, base);
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, sameSite: 'strict', path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_TOKEN_COOKIE, { ...base, httpOnly: false });
}

/** Reads a cookie, treating an empty value as absent. */
export function readCookie(
  cookies: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
