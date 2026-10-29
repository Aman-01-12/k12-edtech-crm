import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit, type Options, type RateLimitInfo } from 'express-rate-limit';
import { config } from '../config/env.js';
import { RateLimitedError } from '../errors/app-error.js';
import { normalizeClientAddress, rateLimitKey } from '../lib/client-identity.js';
import { createRateLimitStore, logRateLimitProblem } from '../lib/postgres-rate-limit-store.js';

/**
 * express-rate-limit attaches its per-request info under a configurable
 * property and types it through its own `AugmentedRequest` rather than
 * augmenting Express. Declaring it here lets the handler read `resetTime`
 * without a cast.
 */
declare module 'express-serve-static-core' {
  interface Request {
    rateLimit?: RateLimitInfo;
  }
}

/**
 * The configured rate limiters.
 *
 * Keying strategy, which is the part that actually decides whether a limit is
 * fair or useless:
 *
 * - **Authenticated actions** key on the admin id. The account is the real
 *   subject, and it cannot be rotated.
 * - **Sign-in** is limited twice, on the account *and* on the network, because
 *   the two attack shapes evade opposite keys. A targeted brute force hits one
 *   account from many addresses, which only an account key catches. Credential
 *   stuffing hits many accounts from one source, which only a network key
 *   catches. OWASP calls for both.
 * - **Anonymous actions** have only the network, which is the weak case. IPv6
 *   is collapsed to the /64 so a client cannot simply pick another address from
 *   its own prefix, and the allowance is deliberately generous because carrier
 *   NAT puts many unrelated people behind one address. On Indian mobile
 *   networks that can be hundreds of users, so a tight per-IP limit would block
 *   a whole school to stop one abuser.
 *
 * Because the network key cannot be made trustworthy, the public form does not
 * rely on it alone. See `middleware/honeypot.ts` and the idempotency key on
 * submission.
 */

/**
 * Translates a limiter trip into the standard error contract.
 *
 * Passed to `next` rather than thrown: the handler is invoked from inside the
 * limiter's own async work, where a throw would become an unhandled rejection
 * instead of reaching the error middleware.
 */
function rejectWithRateLimitError(
  req: Request,
  _res: Response,
  next: NextFunction,
  options: Options,
): void {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds =
    resetTime === undefined
      ? Math.ceil(options.windowMs / 1000)
      : Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));

  next(new RateLimitedError(retryAfterSeconds));
}

/**
 * Options every limiter shares, so none can accidentally differ.
 *
 * A fresh store per call, never a shared one: each limiter's window lives in
 * its store instance, so sharing would collapse every window to whichever
 * initialised last.
 */
function baseOptions(): Partial<Options> {
  return {
    store: createRateLimitStore(),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Availability over enforcement for a counter. See logRateLimitProblem.
    passOnStoreError: true,
    handler: rejectWithRateLimitError,
    // express-rate-limit logs to the console by default, which would bypass
    // the redacting logger.
    logger: { error: logRateLimitProblem, warn: logRateLimitProblem },
  };
}

/** The network subject: an IPv4 address or an IPv6 /64. */
function networkSubject(req: Request): string {
  return normalizeClientAddress(req.ip ?? 'unknown');
}

/**
 * Public inquiry submission, keyed on the network.
 *
 * Generous on purpose. This limit exists to stop a script hammering the
 * endpoint, not to police how many questions one household may ask, and the
 * key is shared by everyone behind the same carrier address.
 */
export const submitLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_SUBMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_SUBMIT_MAX,
  keyGenerator: (req) => rateLimitKey('submit', networkSubject(req)),
});

/**
 * Sign-in, keyed on the account.
 *
 * `skipSuccessfulRequests` is what makes this a failed-attempt budget rather
 * than a sign-in budget: a user who mistypes once and then succeeds is not
 * penalised, while an attacker guessing wrongly is. The email is lowercased so
 * the key cannot be varied by changing capitalisation.
 */
export const loginAccountLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: config.RATE_LIMIT_LOGIN_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Runs before body validation, so the body is untrusted here. A non-string
    // or absent email falls back to the network subject rather than collapsing
    // every malformed attempt into one shared bucket.
    const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
    const subject =
      typeof email === 'string' && email.length > 0 && email.length <= 254
        ? email.trim().toLowerCase()
        : `malformed:${networkSubject(req)}`;
    return rateLimitKey('login-account', subject);
  },
});

/**
 * Sign-in, keyed on the network.
 *
 * Catches credential stuffing, which spreads a handful of attempts across many
 * accounts and so never trips a per-account limit. More generous than the
 * account limit because a school or office shares one address.
 */
export const loginNetworkLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: config.RATE_LIMIT_LOGIN_NETWORK_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => rateLimitKey('login-network', networkSubject(req)),
});

/** Token refresh, keyed on the network. Generous: a busy dashboard refreshes often. */
export const refreshLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_REFRESH_WINDOW_MS,
  limit: config.RATE_LIMIT_REFRESH_MAX,
  keyGenerator: (req) => rateLimitKey('refresh', networkSubject(req)),
});

/**
 * CSV export, keyed on the authenticated admin.
 *
 * The account is the right subject here because the action removes personal
 * data from the application, and an account is accountable in a way an address
 * is not. Runs after authentication, so the principal is available.
 */
export const exportLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_EXPORT_WINDOW_MS,
  limit: config.RATE_LIMIT_EXPORT_MAX,
  keyGenerator: (req) =>
    rateLimitKey('export', req.admin?.adminId ?? `unauthenticated:${networkSubject(req)}`),
});
