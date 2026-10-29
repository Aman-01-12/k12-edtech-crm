import { API_ERROR_CODES, type ApiErrorCode } from '@k12/contracts';

/**
 * The error taxonomy.
 *
 * Every expected failure is one of these subclasses, each carrying a fixed HTTP
 * status and a stable machine-readable code. The status and code therefore
 * belong to the failure itself rather than to whichever route happened to
 * detect it, which is what keeps the API contract consistent.
 *
 * Anything that is not an `AppError` reaching the error middleware is by
 * definition unexpected, and is reported as a generic internal error with no
 * detail leaked.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: ApiErrorCode;

  /**
   * Field-level messages for a validation failure. Safe to return: these
   * describe the caller's own input, not the server's internals.
   */
  readonly details?: Readonly<Record<string, string[]>>;

  /** Seconds the caller should wait, surfaced as `Retry-After`. */
  readonly retryAfterSeconds?: number;

  protected constructor(
    message: string,
    options?: {
      details?: Record<string, string[]>;
      retryAfterSeconds?: number;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    if (options?.details !== undefined) {
      this.details = Object.freeze(options.details);
    }
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/** A request body, query string or path parameter failed its schema. */
export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = API_ERROR_CODES.validationFailed;

  constructor(details: Record<string, string[]>, message = 'The request is invalid.') {
    super(message, { details });
  }
}

/**
 * Sign-in failed.
 *
 * One message and one code for both an unknown email address and a wrong
 * password, so the response cannot be used to enumerate accounts.
 */
export class InvalidCredentialsError extends AppError {
  readonly status = 401;
  readonly code = API_ERROR_CODES.invalidCredentials;

  constructor() {
    super('Incorrect email address or password.');
  }
}

/**
 * The access token is past its expiry but otherwise genuine.
 *
 * Distinct from `TokenInvalidError` because the client's correct reaction is
 * different: refresh silently and replay, rather than sign the user out.
 */
export class TokenExpiredError extends AppError {
  readonly status = 401;
  readonly code = API_ERROR_CODES.tokenExpired;

  constructor() {
    super('Your session has expired.');
  }
}

/** The token is missing, malformed, or fails signature, issuer or audience checks. */
export class TokenInvalidError extends AppError {
  readonly status = 401;
  readonly code = API_ERROR_CODES.tokenInvalid;

  constructor(message = 'Your session is not valid. Please sign in again.') {
    super(message);
  }
}

/**
 * An already-rotated refresh token was presented, which means a token was
 * captured. The whole family is revoked before this is raised.
 */
export class SessionCompromisedError extends AppError {
  readonly status = 401;
  readonly code = API_ERROR_CODES.sessionCompromised;

  constructor() {
    super('This session was ended for security reasons. Please sign in again.');
  }
}

/**
 * A password-reset token was missing, unknown, expired, or already redeemed.
 *
 * One message and one code for all four cases, for the same reason sign-in
 * collapses a wrong password and an unknown address into one response: naming
 * which reason it was would disclose whether the underlying email address has
 * an account.
 */
export class ResetTokenInvalidError extends AppError {
  readonly status = 400;
  readonly code = API_ERROR_CODES.resetTokenInvalid;

  constructor() {
    super('This reset link is invalid or has expired. Request a new one.');
  }
}

/** The double-submit CSRF token was absent or did not match. */
export class CsrfTokenInvalidError extends AppError {
  readonly status = 403;
  readonly code = API_ERROR_CODES.csrfTokenInvalid;

  constructor() {
    super('The request could not be verified. Please reload the page and try again.');
  }
}

/** A named resource does not exist, or the caller may not see that it does. */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = API_ERROR_CODES.notFound;

  constructor(resource = 'resource') {
    super(`The requested ${resource} was not found.`);
  }
}

/** The requested change conflicts with the current state, such as a duplicate email. */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = API_ERROR_CODES.conflict;

  constructor(message: string) {
    super(message);
  }
}

/** The body exceeded the configured size cap and was rejected before parsing. */
export class PayloadTooLargeError extends AppError {
  readonly status = 413;
  readonly code = API_ERROR_CODES.payloadTooLarge;

  constructor() {
    super('The request is too large.');
  }
}

/** A rate limit was exceeded. Always carries the wait, so the client can honour it. */
export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = API_ERROR_CODES.rateLimited;

  constructor(retryAfterSeconds: number, message = 'Too many requests. Please try again shortly.') {
    super(message, { retryAfterSeconds });
  }
}

/**
 * The email provider refused the message or could not be reached.
 *
 * 502 rather than 500: the caller's request was valid and the fault is in an
 * upstream service. Surfaced to the user, unlike the password-reset email's
 * silent failure, because a staff member who believes they have answered an
 * applicant must not be told so wrongly.
 */
export class EmailNotSentError extends AppError {
  readonly status = 502;
  readonly code = API_ERROR_CODES.emailNotSent;

  constructor() {
    super('The email could not be sent. Please try again, or contact them directly.');
  }
}

/**
 * An unexpected failure.
 *
 * Constructed by the error middleware for anything that is not an `AppError`.
 * The message is deliberately generic; the real cause goes to the log against
 * the request id.
 */
export class InternalError extends AppError {
  readonly status = 500;
  readonly code = API_ERROR_CODES.internalError;

  constructor(cause?: unknown) {
    super('Something went wrong. Please try again.', { cause });
  }
}

/** Narrows an unknown thrown value to our taxonomy. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
