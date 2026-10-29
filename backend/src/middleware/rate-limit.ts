import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit, type Options, type RateLimitInfo } from 'express-rate-limit';
import { config } from '../config/env.js';
import { RateLimitedError } from '../errors/app-error.js';
import { normalizeClientAddress, rateLimitKey } from '../lib/client-identity.js';
import { createRateLimitStore, logRateLimitProblem } from '../lib/postgres-rate-limit-store.js';

/**
 * Limiters keyed on the most specific identity available, because every less
 * specific key punishes someone who did nothing. Rationale and the rejected
 * alternatives are in docs/adr/0005-rate-limiting-and-idempotency.md.
 */

// express-rate-limit types this through its own AugmentedRequest rather than
// augmenting Express, so declaring it here avoids a cast in the handler.
declare module 'express-serve-static-core' {
  interface Request {
    rateLimit?: RateLimitInfo;
  }
}

/**
 * Passed to `next` rather than thrown: the handler runs inside the limiter's
 * async work, where a throw becomes an unhandled rejection.
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

/** Shared options, with a fresh store per limiter. */
function baseOptions(): Partial<Options> {
  return {
    store: createRateLimitStore(),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: true,
    handler: rejectWithRateLimitError,
    logger: { error: logRateLimitProblem, warn: logRateLimitProblem },
  };
}

/** IPv4 address, or IPv6 /64. */
function networkSubject(req: Request): string {
  return normalizeClientAddress(req.ip ?? 'unknown');
}

/**
 * Generous on purpose: this key is shared by everyone behind one carrier NAT
 * address, so it stops scripted hammering rather than policing how many
 * questions a household may ask. The honeypot is the control that does not
 * depend on an address.
 */
export const submitLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_SUBMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_SUBMIT_MAX,
  keyGenerator: (req) => rateLimitKey('submit', networkSubject(req)),
});

/**
 * Catches brute force against one account. `skipSuccessfulRequests` makes this
 * a failed-attempt budget, so a user who mistypes once then succeeds is not
 * penalised.
 */
export const loginAccountLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: config.RATE_LIMIT_LOGIN_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Runs before validation, so the body is untrusted. A malformed email falls
    // back to the network rather than collapsing every such attempt into one key.
    const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
    const subject =
      typeof email === 'string' && email.length > 0 && email.length <= 254
        ? email.trim().toLowerCase()
        : `malformed:${networkSubject(req)}`;
    return rateLimitKey('login-account', subject);
  },
});

/**
 * Catches credential stuffing, which spreads few attempts across many accounts
 * and so never trips the per-account limit.
 */
export const loginNetworkLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: config.RATE_LIMIT_LOGIN_NETWORK_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => rateLimitKey('login-network', networkSubject(req)),
});

export const refreshLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_REFRESH_WINDOW_MS,
  limit: config.RATE_LIMIT_REFRESH_MAX,
  keyGenerator: (req) => rateLimitKey('refresh', networkSubject(req)),
});

/**
 * Keyed on network, not on the submitted email. Keying on the email would let
 * an attacker distinguish a rate-limited address from a fresh one, which is the
 * account-existence signal the generic response exists to withhold.
 */
export const forgotPasswordLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS,
  limit: config.RATE_LIMIT_FORGOT_PASSWORD_MAX,
  keyGenerator: (req) => rateLimitKey('forgot-password', networkSubject(req)),
});

/** Caps guessing at a reset token, which is otherwise the one unauthenticated write. */
export const resetPasswordLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_RESET_PASSWORD_WINDOW_MS,
  limit: config.RATE_LIMIT_RESET_PASSWORD_MAX,
  keyGenerator: (req) => rateLimitKey('reset-password', networkSubject(req)),
});

/**
 * Replying emails a third party at the operator's cost and under the
 * operator's sending reputation, so it is capped per account rather than left
 * to whatever a compromised session could send in a minute.
 */
export const replyLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_REPLY_WINDOW_MS,
  limit: config.RATE_LIMIT_REPLY_MAX,
  keyGenerator: (req) =>
    rateLimitKey('reply', req.admin?.adminId ?? `unauthenticated:${networkSubject(req)}`),
});

/** Keyed on the account: an export removes personal data, and an account is accountable. */
export const exportLimiter: RequestHandler = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_EXPORT_WINDOW_MS,
  limit: config.RATE_LIMIT_EXPORT_MAX,
  keyGenerator: (req) =>
    rateLimitKey('export', req.admin?.adminId ?? `unauthenticated:${networkSubject(req)}`),
});
