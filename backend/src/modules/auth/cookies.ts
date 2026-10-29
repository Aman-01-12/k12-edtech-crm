import type { CookieOptions, Response } from 'express';
import { config } from '../../config/env.js';

export const ACCESS_TOKEN_COOKIE = 'k12_access';
export const REFRESH_TOKEN_COOKIE = 'k12_refresh';
export const CSRF_TOKEN_COOKIE = 'k12_csrf';

/** Scoped so the browser never attaches the refresh token to any other route. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Local development is plain HTTP, where a Secure cookie is never stored.
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * Lax rather than Strict: it still withholds the cookie from a cross-site POST,
 * but does send it on a top-level navigation, so following a link to a
 * dashboard route is not treated as a signed-out session.
 */
export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: config.ACCESS_TOKEN_TTL.seconds * 1000,
  });
}

/** Strict is affordable here: this cookie is only ever sent by our own fetch. */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.REFRESH_TOKEN_TTL.seconds * 1000,
  });
}

/**
 * Deliberately readable: the double-submit pattern needs the page to echo this
 * in a header. It is not a credential, only proof the request came from a page
 * served by this origin.
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
 * Each cookie must be cleared with the attributes it was set with, since the
 * browser matches on name, path and domain. Clearing the refresh cookie at `/`
 * would leave the one scoped to the auth path alive and sign-out would not work.
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
