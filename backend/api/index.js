// src/app.ts
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

// src/config/env.ts
import { z } from 'zod';
var JWT_SECRET_MIN_BYTES = 32;
var BCRYPT_COST_MIN = 12;
var BCRYPT_COST_MAX = 15;
function parseDurationToSeconds(value) {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (match === null) {
    return void 0;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const secondsPerUnit = { s: 1, m: 60, h: 3600, d: 86400 };
  if (unit !== 's' && unit !== 'm' && unit !== 'h' && unit !== 'd') {
    return void 0;
  }
  return amount * secondsPerUnit[unit];
}
var durationSchema = z.string().transform((value, ctx) => {
  const seconds = parseDurationToSeconds(value);
  if (seconds === void 0 || seconds <= 0) {
    ctx.addIssue({
      code: 'custom',
      message: `Expected a positive duration such as 15m, 2h or 7d, received ${JSON.stringify(value)}.`,
    });
    return z.NEVER;
  }
  return { raw: value, seconds };
});
var originListSchema = z.string().transform((value) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  ),
);
var positiveIntSchema = z.coerce.number().int().positive();
var environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveIntSchema.max(65535).default(4e3),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  DATABASE_POOL_MAX: positiveIntSchema.max(50).default(5),
  DATABASE_CONNECTION_TIMEOUT_MS: positiveIntSchema.default(5e3),
  DATABASE_STATEMENT_TIMEOUT_MS: positiveIntSchema.default(8e3),
  /**
   * PEM for the database's certificate authority.
   *
   * Supabase signs its Postgres certificate with its own CA, which is not in
   * Node's default trust store, so without this the TLS handshake cannot verify
   * which server it reached. Download it from Database Settings.
   */
  DATABASE_CA_CERT: z.string().min(1).optional(),
  /**
   * Opt out of verifying the database server's certificate.
   *
   * Encryption still applies, but the server's identity is no longer checked,
   * which makes the connection interceptable. It exists only so a deployment is
   * not hard-blocked when the CA is unavailable, must be set deliberately, and
   * is logged loudly on every startup.
   */
  DATABASE_SSL_NO_VERIFY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // No default, and no fallback. A guessable signing key means anyone can mint
  // a valid admin token, so the process must refuse to start without a real one.
  JWT_SECRET: z
    .string()
    .refine(
      (secret) => Buffer.byteLength(secret, 'utf8') >= JWT_SECRET_MIN_BYTES,
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_BYTES} bytes. Generate one with: node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`,
    ),
  JWT_ISSUER: z.string().min(1).default('k12-edtech-crm'),
  JWT_AUDIENCE: z.string().min(1).default('k12-edtech-crm-admin'),
  // `prefault` rather than `default`: the default is a duration string that
  // still has to go through the transform, whereas `default` would supply the
  // already-converted output and duplicate the conversion.
  ACCESS_TOKEN_TTL: durationSchema.prefault('15m'),
  REFRESH_TOKEN_TTL: durationSchema.prefault('7d'),
  BCRYPT_COST: z.coerce.number().int().min(BCRYPT_COST_MIN).max(BCRYPT_COST_MAX).default(12),
  CORS_ALLOWED_ORIGINS: originListSchema.prefault('http://localhost:5173'),
  BODY_LIMIT: z.string().min(1).default('16kb'),
  RATE_LIMIT_SUBMIT_WINDOW_MS: positiveIntSchema.default(6e4),
  RATE_LIMIT_SUBMIT_MAX: positiveIntSchema.default(5),
  RATE_LIMIT_LOGIN_WINDOW_MS: positiveIntSchema.default(9e5),
  // Failed attempts against one account. Within NCSC's 5-to-10 guidance for a
  // lockout threshold, except this is a self-healing window rather than a
  // lockout, so it cannot be used to deny a real user access indefinitely.
  RATE_LIMIT_LOGIN_MAX: positiveIntSchema.default(10),
  // Failed attempts from one network, which is what catches credential
  // stuffing across many accounts. Higher than the per-account limit because
  // a school or office shares one address.
  RATE_LIMIT_LOGIN_NETWORK_MAX: positiveIntSchema.default(50),
  RATE_LIMIT_REFRESH_WINDOW_MS: positiveIntSchema.default(9e5),
  RATE_LIMIT_REFRESH_MAX: positiveIntSchema.default(60),
  RATE_LIMIT_EXPORT_WINDOW_MS: positiveIntSchema.default(9e5),
  RATE_LIMIT_EXPORT_MAX: positiveIntSchema.default(10),
  EXPORT_ROW_LIMIT: positiveIntSchema.max(5e4).default(5e3),
});
function loadConfig() {
  const present = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && value.length > 0) {
      present[key] = value;
    }
  }
  const result = environmentSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    process.stderr.write(
      `Invalid environment configuration. The server will not start.
${problems}

See .env.example for the required variables.
`,
    );
    process.exit(1);
  }
  const parsed = result.data;
  return Object.freeze({
    ...parsed,
    isProduction: parsed.NODE_ENV === 'production',
    isTest: parsed.NODE_ENV === 'test',
  });
}
var config = loadConfig();

// ../packages/contracts/src/api.ts
import { z as z2 } from 'zod';
var apiErrorSchema = z2.object({
  error: z2.string(),
  code: z2.string(),
  requestId: z2.string(),
  /** Field-level messages, present only on a validation failure. */
  details: z2.record(z2.string(), z2.array(z2.string())).optional(),
});
var API_ERROR_CODES = {
  validationFailed: 'VALIDATION_FAILED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  tokenExpired: 'TOKEN_EXPIRED',
  tokenInvalid: 'TOKEN_INVALID',
  sessionCompromised: 'SESSION_COMPROMISED',
  csrfTokenInvalid: 'CSRF_TOKEN_INVALID',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  rateLimited: 'RATE_LIMITED',
  internalError: 'INTERNAL_ERROR',
};

// ../packages/contracts/src/auth.ts
import { z as z4 } from 'zod';

// ../packages/contracts/src/fields.ts
import { z as z3 } from 'zod';

// ../packages/contracts/src/phone.ts
var INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;
var COUNTRY_CODE = '+91';
var SEPARATORS_PATTERN = /[\s().\-\u2010-\u2015]/g;
function toNationalNumber(digits) {
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 14 && digits.startsWith('0091')) {
    return digits.slice(4);
  }
  return void 0;
}
function normalizeIndianPhone(raw) {
  const compact = raw.replace(SEPARATORS_PATTERN, '');
  const withoutPlus = compact.startsWith('+') ? compact.slice(1) : compact;
  if (withoutPlus.includes('+') || !/^\d+$/.test(withoutPlus)) {
    return void 0;
  }
  const national = toNationalNumber(withoutPlus);
  if (national === void 0 || !INDIAN_MOBILE_PATTERN.test(national)) {
    return void 0;
  }
  return `${COUNTRY_CODE}${national}`;
}
function toPhoneSearchFragment(term) {
  const digits = term.replace(/\D/g, '');
  if (digits.length === 0) {
    return void 0;
  }
  const withoutTrunkPrefix = digits.startsWith('0') ? digits.replace(/^0+/, '') : digits;
  return withoutTrunkPrefix.length === 0 ? void 0 : withoutTrunkPrefix;
}

// ../packages/contracts/src/text.ts
function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ');
}
var CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
function containsControlCharacters(value, allowed = '') {
  for (const character of value) {
    if (CONTROL_OR_FORMAT.test(character) && !allowed.includes(character)) {
      return true;
    }
  }
  return false;
}
var TEXT_BLOCK_ALLOWED_CONTROLS = '\n\r	';
function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

// ../packages/contracts/src/fields.ts
var FULL_NAME_MIN_LENGTH = 2;
var FULL_NAME_MAX_LENGTH = 120;
var EMAIL_MAX_LENGTH = 254;
var MESSAGE_MIN_LENGTH = 10;
var MESSAGE_MAX_LENGTH = 2e3;
var PASSWORD_MAX_BYTES = 72;
var PASSWORD_MIN_LENGTH = 12;
var fullNameSchema = z3
  .string()
  .trim()
  .transform(collapseWhitespace)
  .pipe(
    z3
      .string()
      .min(FULL_NAME_MIN_LENGTH, `Name must be at least ${FULL_NAME_MIN_LENGTH} characters.`)
      .max(FULL_NAME_MAX_LENGTH, `Name must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`)
      .refine(
        (value) => !containsControlCharacters(value),
        'Name contains unsupported characters.',
      ),
  );
var emailSchema = z3
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z3
      .email('Enter a valid email address.')
      .max(EMAIL_MAX_LENGTH, `Email must be ${EMAIL_MAX_LENGTH} characters or fewer.`),
  );
var phoneSchema = z3
  .string()
  .trim()
  .transform((raw, ctx) => {
    const normalized = normalizeIndianPhone(raw);
    if (normalized === void 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid 10-digit Indian mobile number.',
      });
      return z3.NEVER;
    }
    return normalized;
  });
var messageSchema = z3
  .string()
  .trim()
  .pipe(
    z3
      .string()
      .min(MESSAGE_MIN_LENGTH, `Message must be at least ${MESSAGE_MIN_LENGTH} characters.`)
      .max(MESSAGE_MAX_LENGTH, `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`)
      .refine(
        (value) => !containsControlCharacters(value, TEXT_BLOCK_ALLOWED_CONTROLS),
        'Message contains unsupported characters.',
      ),
  );
var loginPasswordSchema = z3
  .string()
  .min(1, 'Enter your password.')
  .refine(
    (value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES,
    `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.`,
  );
var newPasswordSchema = z3
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .refine(
    (value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES,
    `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.`,
  )
  .refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter.')
  .refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password must contain a digit.');

// ../packages/contracts/src/auth.ts
var loginSchema = z4.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
});
var authenticatedAdminSchema = z4.object({
  id: z4.uuid(),
  email: z4.string(),
  fullName: z4.string(),
});
var loginResponseSchema = z4.object({
  admin: authenticatedAdminSchema,
  expiresIn: z4.number().int().positive(),
});
var adminFullNameSchema = z4
  .string()
  .trim()
  .min(2, 'Full name must be at least 2 characters.')
  .max(120, 'Full name must be 120 characters or fewer.');
var provisionAdminSchema = z4.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  fullName: adminFullNameSchema,
});
var createAdminSchema = z4.strictObject({
  email: emailSchema,
  fullName: adminFullNameSchema,
});
var changePasswordSchema = z4.strictObject({
  currentPassword: loginPasswordSchema,
  newPassword: newPasswordSchema,
});
var adminSummarySchema = z4.object({
  id: z4.uuid(),
  email: z4.string(),
  fullName: z4.string(),
  lastLoginAt: z4.iso.datetime().nullable(),
  createdAt: z4.iso.datetime(),
});

// ../packages/contracts/src/enums.ts
import { z as z5 } from 'zod';
var USER_TYPES = ['parent', 'student', 'school'];
var userTypeSchema = z5.enum(USER_TYPES);
var INQUIRY_CATEGORIES = ['scholarship', 'concert', 'admission', 'general_query'];
var inquiryCategorySchema = z5.enum(INQUIRY_CATEGORIES);
var INQUIRY_STATUSES = ['new', 'in_progress', 'resolved', 'closed'];
var inquiryStatusSchema = z5.enum(INQUIRY_STATUSES);
var USER_TYPE_LABELS = {
  parent: 'Parent',
  student: 'Student',
  school: 'School',
};
var INQUIRY_CATEGORY_LABELS = {
  scholarship: 'Scholarship',
  concert: 'Concert',
  admission: 'Admission',
  general_query: 'General Query',
};
var INQUIRY_STATUS_LABELS = {
  new: 'New',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

// ../packages/contracts/src/inquiry.ts
import { z as z6 } from 'zod';
var createInquirySchema = z6.strictObject({
  userType: userTypeSchema,
  category: inquiryCategorySchema,
  fullName: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  message: messageSchema,
  /**
   * Honeypot. Rendered off-screen and hidden from assistive technology, so a
   * human never fills it and a bot that fills every input does. Declared here
   * because the schema is strict and would otherwise reject the field outright,
   * which would turn the trap into a plain validation error and tell the bot
   * exactly what happened.
   */
  website: z6.string().max(200).optional(),
});
var HONEYPOT_FIELD = 'website';
var inquirySchema = z6.object({
  id: z6.uuid(),
  userType: userTypeSchema,
  category: inquiryCategorySchema,
  status: inquiryStatusSchema,
  fullName: z6.string(),
  email: z6.string(),
  phone: z6.string(),
  message: z6.string(),
  createdAt: z6.iso.datetime(),
  statusUpdatedAt: z6.iso.datetime().nullable(),
});
var updateInquiryStatusSchema = z6.strictObject({
  status: inquiryStatusSchema,
});
var inquiryIdParamSchema = z6.strictObject({
  id: z6.uuid('Inquiry id must be a UUID.'),
});

// ../packages/contracts/src/inquiry-query.ts
import { z as z7 } from 'zod';
var SEARCH_MIN_LENGTH = 2;
var SEARCH_MAX_LENGTH = 80;
var PAGE_SIZE_DEFAULT = 20;
var PAGE_SIZE_MAX = 100;
function emptyToUndefined(value) {
  return value === '' ? void 0 : value;
}
var listInquiriesQuerySchema = z7.strictObject({
  category: z7.preprocess(emptyToUndefined, inquiryCategorySchema.optional()),
  userType: z7.preprocess(emptyToUndefined, userTypeSchema.optional()),
  search: z7.preprocess(
    emptyToUndefined,
    z7
      .string()
      .trim()
      .min(SEARCH_MIN_LENGTH, `Search needs at least ${SEARCH_MIN_LENGTH} characters.`)
      .max(SEARCH_MAX_LENGTH, `Search must be ${SEARCH_MAX_LENGTH} characters or fewer.`)
      .optional(),
  ),
  /** Opaque keyset page marker produced by a previous response. */
  cursor: z7.preprocess(emptyToUndefined, z7.base64url('Malformed page cursor.').optional()),
  limit: z7.coerce
    .number()
    .int('Limit must be a whole number.')
    .min(1, 'Limit must be at least 1.')
    .max(PAGE_SIZE_MAX, `Limit must be ${PAGE_SIZE_MAX} or fewer.`)
    .default(PAGE_SIZE_DEFAULT),
});

// src/errors/app-error.ts
var AppError = class extends Error {
  /**
   * Field-level messages for a validation failure. Safe to return: these
   * describe the caller's own input, not the server's internals.
   */
  details;
  /** Seconds the caller should wait, surfaced as `Retry-After`. */
  retryAfterSeconds;
  constructor(message, options) {
    super(message, options?.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = new.target.name;
    if (options?.details !== void 0) {
      this.details = Object.freeze(options.details);
    }
    if (options?.retryAfterSeconds !== void 0) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
};
var ValidationError = class extends AppError {
  status = 400;
  code = API_ERROR_CODES.validationFailed;
  constructor(details, message = 'The request is invalid.') {
    super(message, { details });
  }
};
var InvalidCredentialsError = class extends AppError {
  status = 401;
  code = API_ERROR_CODES.invalidCredentials;
  constructor() {
    super('Incorrect email address or password.');
  }
};
var TokenExpiredError = class extends AppError {
  status = 401;
  code = API_ERROR_CODES.tokenExpired;
  constructor() {
    super('Your session has expired.');
  }
};
var TokenInvalidError = class extends AppError {
  status = 401;
  code = API_ERROR_CODES.tokenInvalid;
  constructor(message = 'Your session is not valid. Please sign in again.') {
    super(message);
  }
};
var SessionCompromisedError = class extends AppError {
  status = 401;
  code = API_ERROR_CODES.sessionCompromised;
  constructor() {
    super('This session was ended for security reasons. Please sign in again.');
  }
};
var CsrfTokenInvalidError = class extends AppError {
  status = 403;
  code = API_ERROR_CODES.csrfTokenInvalid;
  constructor() {
    super('The request could not be verified. Please reload the page and try again.');
  }
};
var NotFoundError = class extends AppError {
  status = 404;
  code = API_ERROR_CODES.notFound;
  constructor(resource = 'resource') {
    super(`The requested ${resource} was not found.`);
  }
};
var ConflictError = class extends AppError {
  status = 409;
  code = API_ERROR_CODES.conflict;
  constructor(message) {
    super(message);
  }
};
var PayloadTooLargeError = class extends AppError {
  status = 413;
  code = API_ERROR_CODES.payloadTooLarge;
  constructor() {
    super('The request is too large.');
  }
};
var RateLimitedError = class extends AppError {
  status = 429;
  code = API_ERROR_CODES.rateLimited;
  constructor(retryAfterSeconds, message = 'Too many requests. Please try again shortly.') {
    super(message, { retryAfterSeconds });
  }
};
var InternalError = class extends AppError {
  status = 500;
  code = API_ERROR_CODES.internalError;
  constructor(cause) {
    super('Something went wrong. Please try again.', { cause });
  }
};
function isAppError(value) {
  return value instanceof AppError;
}

// src/middleware/error-handler.ts
function normalize(error) {
  if (isAppError(error)) {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const { type } = error;
    if (type === 'entity.too.large') {
      return new PayloadTooLargeError();
    }
    if (type === 'entity.parse.failed') {
      return new ValidationError({ _: ['The request body is not valid JSON.'] });
    }
  }
  return new InternalError(error);
}
var errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    req.log.error({ err: error }, 'Request failed after the response had begun');
    next(error);
    return;
  }
  const appError = normalize(error);
  if (appError instanceof InternalError) {
    req.log.error(
      { err: appError.cause ?? error, method: req.method, path: req.path },
      'Unhandled error',
    );
  } else {
    req.log.info(
      { code: appError.code, status: appError.status, method: req.method, path: req.path },
      'Request rejected',
    );
  }
  if (appError.retryAfterSeconds !== void 0) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }
  const body = {
    error: appError.message,
    code: appError.code,
    requestId: req.requestId,
    ...(appError.details === void 0 ? {} : { details: appError.details }),
  };
  res.status(appError.status).json(body);
};
var notFoundHandler = (_req, _res, next) => {
  next(new NotFoundError('endpoint'));
};

// src/middleware/request-context.ts
import { randomUUID } from 'node:crypto';

// src/lib/logger.ts
import { pino } from 'pino';
var REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'res.headers["set-cookie"]',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'secret',
  'DATABASE_URL',
  'JWT_SECRET',
];
var logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  // Epoch in production so an aggregator parses it without a custom format.
  timestamp: config.isProduction ? pino.stdTimeFunctions.epochTime : pino.stdTimeFunctions.isoTime,
  base: { service: 'k12-edtech-crm-api' },
  formatters: { level: (label) => ({ level: label }) },
});

// src/middleware/request-context.ts
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var REQUEST_ID_HEADER = 'x-request-id';
function requestContext(req, res, next) {
  const supplied = req.get(REQUEST_ID_HEADER);
  const requestId = supplied !== void 0 && UUID_PATTERN.test(supplied) ? supplied : randomUUID();
  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

// src/modules/admins/admins.routes.ts
import { randomBytes as randomBytes2 } from 'node:crypto';
import { Router } from 'express';
import { z as z8 } from 'zod';

// src/modules/auth/cookies.ts
var ACCESS_TOKEN_COOKIE = 'k12_access';
var REFRESH_TOKEN_COOKIE = 'k12_refresh';
var CSRF_TOKEN_COOKIE = 'k12_csrf';
var REFRESH_COOKIE_PATH = '/api/v1/auth';
function baseCookieOptions() {
  return {
    httpOnly: true,
    // Local development is plain HTTP, where a Secure cookie is never stored.
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  };
}
function setAccessTokenCookie(res, token) {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: config.ACCESS_TOKEN_TTL.seconds * 1e3,
  });
}
function setRefreshTokenCookie(res, token) {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.REFRESH_TOKEN_TTL.seconds * 1e3,
  });
}
function setCsrfTokenCookie(res, token) {
  res.cookie(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: config.REFRESH_TOKEN_TTL.seconds * 1e3,
  });
}
function clearSessionCookies(res) {
  const base = baseCookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, base);
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, sameSite: 'strict', path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_TOKEN_COOKIE, { ...base, httpOnly: false });
}
function readCookie(cookies, name) {
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : void 0;
}

// src/modules/auth/tokens.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
var ALGORITHM = 'HS256';
var REFRESH_TOKEN_BYTES = 32;
var secretKey = new TextEncoder().encode(config.JWT_SECRET);
async function signAccessToken(claims) {
  const issuedAt = Math.floor(Date.now() / 1e3);
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(claims.adminId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.ACCESS_TOKEN_TTL.seconds)
    .sign(secretKey);
}
async function verifyAccessToken(token) {
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
function generateRefreshToken() {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}
function hashRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}
function generateCsrfToken() {
  return randomBytes(32).toString('base64url');
}
function csrfTokensMatch(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

// src/middleware/csrf.ts
var CSRF_HEADER = 'x-csrf-token';
var requireCsrfToken = (req, _res, next) => {
  const cookieToken = readCookie(req.cookies, CSRF_TOKEN_COOKIE);
  const headerToken = req.get(CSRF_HEADER);
  if (cookieToken === void 0 || headerToken === void 0 || headerToken.length === 0) {
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

// src/db/pool.ts
import { rootCertificates } from 'node:tls';
import pg from 'pg';
var POSTGRES_BIGINT_OID = 20;
pg.types.setTypeParser(POSTGRES_BIGINT_OID, (value) => Number.parseInt(value, 10));
function resolveSslConfig() {
  let host = '';
  try {
    host = new URL(config.DATABASE_URL).hostname;
  } catch {}
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return false;
  }
  if (config.DATABASE_CA_CERT !== void 0) {
    return { ca: [config.DATABASE_CA_CERT, ...rootCertificates], rejectUnauthorized: true };
  }
  if (config.DATABASE_SSL_NO_VERIFY) {
    logger.warn(
      { host },
      'Database TLS verification is DISABLED by DATABASE_SSL_NO_VERIFY. The connection is encrypted but the server identity is unverified. Set DATABASE_CA_CERT instead.',
    );
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}
var pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  // Fail fast rather than queueing behind an exhausted pool.
  connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: 3e4,
  // Enforced by Postgres, so it still applies if the client goes away.
  statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
  ssl: resolveSslConfig(),
});
pool.on('error', (error) => {
  logger.error({ err: error }, 'Idle database client errored');
});
async function checkDatabaseReachable() {
  try {
    await pool.query('select 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return false;
  }
}

// src/modules/auth/admin.repository.ts
async function findLiveAdminCredentialByEmail(email) {
  const { rows } = await pool.query(
    `select id, email, full_name, password_hash
       from admins
      where lower(email) = lower($1)
        and deleted_at is null
      limit 1`,
    [email],
  );
  return rows[0];
}
async function findLiveAdminById(id) {
  const { rows } = await pool.query(
    `select id, email, full_name, last_login_at, created_at
       from admins
      where id = $1
        and deleted_at is null
      limit 1`,
    [id],
  );
  return rows[0];
}
async function markSignedIn(adminId) {
  await pool.query(`update admins set last_login_at = now() where id = $1`, [adminId]);
}
async function listLiveAdmins() {
  const { rows } = await pool.query(
    `select id, email, full_name, last_login_at, created_at
       from admins
      where deleted_at is null
      order by created_at desc, id desc`,
  );
  return rows;
}
async function insertAdmin(input, client = pool) {
  const { rows } = await client.query(
    `insert into admins (email, password_hash, full_name)
     select $1, $2, $3
      where not exists (
        select 1 from admins where lower(email) = lower($1) and deleted_at is null
      )
     returning id, email, full_name, last_login_at, created_at`,
    [input.email, input.passwordHash, input.fullName],
  );
  return rows[0];
}
async function softDeleteAdmin(id, client = pool) {
  const { rowCount } = await client.query(
    `update admins set deleted_at = now() where id = $1 and deleted_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
async function updatePasswordHash(adminId, passwordHash, client = pool) {
  const { rowCount } = await client.query(
    `update admins set password_hash = $2 where id = $1 and deleted_at is null`,
    [adminId, passwordHash],
  );
  return (rowCount ?? 0) > 0;
}
async function findLiveAdminCredentialById(id) {
  const { rows } = await pool.query(
    `select id, email, full_name, password_hash
       from admins
      where id = $1
        and deleted_at is null
      limit 1`,
    [id],
  );
  return rows[0];
}

// src/middleware/require-admin.ts
var requireAdmin = (req, _res, next) => {
  void (async () => {
    try {
      const token = readCookie(req.cookies, ACCESS_TOKEN_COOKIE);
      if (token === void 0) {
        throw new TokenInvalidError('You are not signed in.');
      }
      const claims = await verifyAccessToken(token);
      const admin = await findLiveAdminById(claims.adminId);
      if (admin === void 0) {
        throw new TokenInvalidError('Your account is no longer active.');
      }
      req.admin = { adminId: admin.id, email: admin.email, fullName: admin.full_name };
      next();
    } catch (error) {
      next(error);
    }
  })();
};

// src/middleware/validate.ts
function toFieldErrors(error) {
  const details = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    const existing = details[field];
    if (existing === void 0) {
      details[field] = [issue.message];
    } else {
      existing.push(issue.message);
    }
  }
  return details;
}
function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}
function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}
function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }
    req.validatedParams = result.data;
    next();
  };
}

// src/db/transaction.ts
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// src/modules/auth/password.ts
import bcrypt from 'bcrypt';
function assertHashableLength(password) {
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    throw new RangeError(
      `Password exceeds bcrypt's ${PASSWORD_MAX_BYTES}-byte input limit and would be silently truncated.`,
    );
  }
}
async function hashPassword(password) {
  assertHashableLength(password);
  return bcrypt.hash(password, config.BCRYPT_COST);
}
var dummyHashPromise = bcrypt.hash('account-absent-timing-equaliser', config.BCRYPT_COST);
async function verifyPassword(password, hash) {
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    return false;
  }
  return bcrypt.compare(password, hash);
}
async function verifyAgainstDummyHash(password) {
  await bcrypt.compare(password, await dummyHashPromise);
  return false;
}

// src/modules/auth/refresh-token.repository.ts
async function findByHashIncludingRevoked(tokenHash, client = pool) {
  const { rows } = await client.query(
    `select id, admin_id, family_id, expires_at, revoked_at
       from refresh_tokens
      where token_hash = $1
      limit 1`,
    [tokenHash],
  );
  return rows[0];
}
async function insertRefreshToken(input, client = pool) {
  const { rows } = await client.query(
    `insert into refresh_tokens
       (admin_id, token_hash, family_id, predecessor_id, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.adminId,
      input.tokenHash,
      input.familyId,
      input.predecessorId ?? null,
      input.userAgent ?? null,
      input.ipAddress ?? null,
      input.expiresAt,
    ],
  );
  const id = rows[0]?.id;
  if (id === void 0) {
    throw new Error('Refresh token insert returned no row');
  }
  return id;
}
async function revokeToken(id, client = pool) {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
async function revokeFamily(familyId, client = pool) {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`,
    [familyId],
  );
  return rowCount ?? 0;
}
async function revokeAllForAdmin(adminId, client = pool) {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where admin_id = $1 and revoked_at is null`,
    [adminId],
  );
  return rowCount ?? 0;
}

// src/modules/auth/security-event.repository.ts
async function recordSecurityEvent(event, onFailure, client = pool) {
  try {
    await client.query(
      `insert into security_events
         (event_type, admin_id, email_attempted, ip_address, user_agent, detail, request_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        event.eventType,
        event.adminId ?? null,
        event.emailAttempted ?? null,
        event.ipAddress ?? null,
        event.userAgent ?? null,
        JSON.stringify(event.detail ?? {}),
        event.requestId ?? null,
      ],
    );
  } catch (error) {
    onFailure?.(error);
  }
}

// src/modules/admins/admins.routes.ts
var adminsRouter = Router();
var adminIdParamSchema = z8.strictObject({ id: z8.uuid('Admin id must be a UUID.') });
var PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
var GENERATED_PASSWORD_LENGTH = 24;
function generateInitialPassword() {
  const bytes = randomBytes2(GENERATED_PASSWORD_LENGTH * 2);
  let password = '';
  for (let i = 0; password.length < GENERATED_PASSWORD_LENGTH; i += 1) {
    const byte = bytes[i];
    if (byte === void 0) {
      break;
    }
    if (byte < 256 - (256 % PASSWORD_ALPHABET.length)) {
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return password;
}
function toSummary(record) {
  return {
    id: record.id,
    email: record.email,
    fullName: record.full_name,
    lastLoginAt: record.last_login_at?.toISOString() ?? null,
    createdAt: record.created_at.toISOString(),
  };
}
adminsRouter.get('/', requireAdmin, async (_req, res) => {
  const admins = await listLiveAdmins();
  res.status(200).json({ admins: admins.map(toSummary) });
});
adminsRouter.post(
  '/',
  requireAdmin,
  requireCsrfToken,
  validateBody(createAdminSchema),
  async (req, res) => {
    const actor = req.admin;
    if (actor === void 0) {
      throw new TokenInvalidError();
    }
    const { email, fullName } = req.body;
    const password = generateInitialPassword();
    const created = await insertAdmin({
      email,
      fullName,
      passwordHash: await hashPassword(password),
    });
    if (created === void 0) {
      throw new ConflictError('An active account already uses that email address.');
    }
    await recordSecurityEvent(
      {
        eventType: 'admin_account_changed',
        adminId: actor.adminId,
        requestId: req.requestId,
        ipAddress: req.ip,
        detail: { action: 'created', targetAdminId: created.id },
      },
      (error) => req.log.error({ err: error }, 'Failed to record admin creation'),
    );
    res.status(201).json({ admin: toSummary(created), initialPassword: password });
  },
);
adminsRouter.delete(
  '/:id',
  requireAdmin,
  requireCsrfToken,
  validateParams(adminIdParamSchema),
  async (req, res) => {
    const actor = req.admin;
    if (actor === void 0) {
      throw new TokenInvalidError();
    }
    const { id } = req.validatedParams;
    if (id === actor.adminId) {
      throw new ValidationError({ id: ['You cannot deactivate your own account.'] });
    }
    const deactivated = await withTransaction(async (client) => {
      const removed = await softDeleteAdmin(id, client);
      if (removed) {
        await revokeAllForAdmin(id, client);
      }
      return removed;
    });
    if (!deactivated) {
      throw new NotFoundError('admin account');
    }
    await recordSecurityEvent(
      {
        eventType: 'admin_account_changed',
        adminId: actor.adminId,
        requestId: req.requestId,
        ipAddress: req.ip,
        detail: { action: 'deactivated', targetAdminId: id },
      },
      (error) => req.log.error({ err: error }, 'Failed to record admin deactivation'),
    );
    res.status(204).send();
  },
);

// src/modules/auth/auth.routes.ts
import { Router as Router2 } from 'express';

// src/middleware/rate-limit.ts
import { rateLimit } from 'express-rate-limit';

// src/lib/client-identity.ts
import { isIPv4, isIPv6 } from 'node:net';
var IPV6_SUBSCRIBER_PREFIX_HEXTETS = 4;
var IPV6_HEXTET_COUNT = 8;
function expandIPv6(address) {
  const [head, tail, ...extra] = address.split('::');
  if (extra.length > 0 || head === void 0) {
    return void 0;
  }
  const headGroups = head.length > 0 ? head.split(':') : [];
  const tailGroups = tail !== void 0 && tail.length > 0 ? tail.split(':') : [];
  if (tail === void 0) {
    return headGroups.length === IPV6_HEXTET_COUNT ? headGroups : void 0;
  }
  const missing = IPV6_HEXTET_COUNT - headGroups.length - tailGroups.length;
  if (missing < 0) {
    return void 0;
  }
  return [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups];
}
function normalizeClientAddress(address) {
  if (isIPv4(address)) {
    return address;
  }
  if (!isIPv6(address)) {
    return address;
  }
  const mappedIPv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mappedIPv4?.[1] !== void 0 && isIPv4(mappedIPv4[1])) {
    return mappedIPv4[1];
  }
  const hextets = expandIPv6(address.split('%')[0] ?? address);
  if (hextets === void 0) {
    return address;
  }
  return `${hextets.slice(0, IPV6_SUBSCRIBER_PREFIX_HEXTETS).join(':')}::/64`;
}
function rateLimitKey(purpose, subject) {
  return `${purpose}:${subject}`;
}

// src/lib/postgres-rate-limit-store.ts
var INCREMENT_SQL = `
  with bumped as (
    insert into rate_limit_hits (bucket_key, window_start, hit_count)
    values ($1, $2, 1)
    on conflict (bucket_key, window_start)
    do update set hit_count = rate_limit_hits.hit_count + 1
    returning hit_count
  )
  select
    (select hit_count from bumped) as current_hits,
    coalesce(
      (select hit_count from rate_limit_hits where bucket_key = $1 and window_start = $3),
      0
    ) as previous_hits
`;
var PEEK_SQL = `
  select
    coalesce((select hit_count from rate_limit_hits where bucket_key = $1 and window_start = $2), 0) as current_hits,
    coalesce((select hit_count from rate_limit_hits where bucket_key = $1 and window_start = $3), 0) as previous_hits
`;
var SWEEP_WINDOW_MULTIPLE = 3;
var PostgresRateLimitStore = class {
  /** Counters are shared through the database, so instances are not isolated. */
  localKeys = false;
  windowMs = 6e4;
  init(options) {
    this.windowMs = options.windowMs;
  }
  boundaries(now) {
    const currentStartMs = Math.floor(now / this.windowMs) * this.windowMs;
    return {
      current: new Date(currentStartMs),
      previous: new Date(currentStartMs - this.windowMs),
      elapsedFraction: (now - currentStartMs) / this.windowMs,
    };
  }
  /** Rounded up, so a partial hit counts and a caller cannot sit under the limit. */
  estimate(row, elapsedFraction) {
    return Math.ceil(row.previous_hits * (1 - elapsedFraction) + row.current_hits);
  }
  async increment(key) {
    const now = Date.now();
    const { current, previous, elapsedFraction } = this.boundaries(now);
    const { rows } = await pool.query(INCREMENT_SQL, [key, current, previous]);
    const row = rows[0] ?? { current_hits: 1, previous_hits: 0 };
    return {
      totalHits: this.estimate(row, elapsedFraction),
      resetTime: new Date(current.getTime() + this.windowMs),
    };
  }
  async get(key) {
    const now = Date.now();
    const { current, previous, elapsedFraction } = this.boundaries(now);
    const { rows } = await pool.query(PEEK_SQL, [key, current, previous]);
    const row = rows[0];
    if (row === void 0) {
      return void 0;
    }
    return {
      totalHits: this.estimate(row, elapsedFraction),
      resetTime: new Date(current.getTime() + this.windowMs),
    };
  }
  /** Used by `skipSuccessfulRequests`, so a successful sign-in costs nothing. */
  async decrement(key) {
    const { current } = this.boundaries(Date.now());
    await pool.query(
      `update rate_limit_hits
          set hit_count = greatest(hit_count - 1, 0)
        where bucket_key = $1 and window_start = $2`,
      [key, current],
    );
  }
  async resetKey(key) {
    await pool.query('delete from rate_limit_hits where bucket_key = $1', [key]);
  }
  /**
   * Called opportunistically rather than on a timer, since a serverless
   * instance has no reliable scheduler and a leaked interval would keep it alive.
   */
  async sweepExpired() {
    const cutoff = new Date(Date.now() - this.windowMs * SWEEP_WINDOW_MULTIPLE);
    const { rowCount } = await pool.query('delete from rate_limit_hits where window_start < $1', [
      cutoff,
    ]);
    return rowCount ?? 0;
  }
};
function createRateLimitStore() {
  return new PostgresRateLimitStore();
}
function logRateLimitProblem(error, message) {
  logger.warn({ err: error }, message ?? 'Rate limiter reported a problem');
}

// src/middleware/rate-limit.ts
function rejectWithRateLimitError(req, _res, next, options) {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds =
    resetTime === void 0
      ? Math.ceil(options.windowMs / 1e3)
      : Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1e3));
  next(new RateLimitedError(retryAfterSeconds));
}
function baseOptions() {
  return {
    store: createRateLimitStore(),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: true,
    handler: rejectWithRateLimitError,
    logger: { error: logRateLimitProblem, warn: logRateLimitProblem },
  };
}
function networkSubject(req) {
  return normalizeClientAddress(req.ip ?? 'unknown');
}
var submitLimiter = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_SUBMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_SUBMIT_MAX,
  keyGenerator: (req) => rateLimitKey('submit', networkSubject(req)),
});
var loginAccountLimiter = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: config.RATE_LIMIT_LOGIN_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = req.body?.email;
    const subject =
      typeof email === 'string' && email.length > 0 && email.length <= 254
        ? email.trim().toLowerCase()
        : `malformed:${networkSubject(req)}`;
    return rateLimitKey('login-account', subject);
  },
});
var loginNetworkLimiter = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: config.RATE_LIMIT_LOGIN_NETWORK_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => rateLimitKey('login-network', networkSubject(req)),
});
var refreshLimiter = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_REFRESH_WINDOW_MS,
  limit: config.RATE_LIMIT_REFRESH_MAX,
  keyGenerator: (req) => rateLimitKey('refresh', networkSubject(req)),
});
var exportLimiter = rateLimit({
  ...baseOptions(),
  windowMs: config.RATE_LIMIT_EXPORT_WINDOW_MS,
  limit: config.RATE_LIMIT_EXPORT_MAX,
  keyGenerator: (req) =>
    rateLimitKey('export', req.admin?.adminId ?? `unauthenticated:${networkSubject(req)}`),
});

// src/modules/auth/auth.service.ts
import { randomUUID as randomUUID2 } from 'node:crypto';
function toAuthenticatedAdmin(record) {
  return { id: record.id, email: record.email, fullName: record.full_name };
}
async function issueSession(admin, options, context) {
  const { token: refreshToken, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL.seconds * 1e3);
  await insertRefreshToken({
    adminId: admin.id,
    tokenHash,
    familyId: options.familyId,
    expiresAt,
    predecessorId: options.predecessorId,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });
  const accessToken = await signAccessToken({ adminId: admin.id, email: admin.email });
  return {
    admin: toAuthenticatedAdmin(admin),
    accessToken,
    refreshToken,
    csrfToken: generateCsrfToken(),
    // Derived from the same configured value used to sign the token, never a
    // literal, so the two cannot disagree.
    expiresInSeconds: config.ACCESS_TOKEN_TTL.seconds,
  };
}
async function signIn(credentials, context) {
  const admin = await findLiveAdminCredentialByEmail(credentials.email);
  if (admin === void 0) {
    await verifyAgainstDummyHash(credentials.password);
    await recordSecurityEvent(
      {
        eventType: 'login_failure',
        emailAttempted: credentials.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        detail: { reason: 'no_such_account' },
      },
      context.onAuditFailure,
    );
    throw new InvalidCredentialsError();
  }
  const passwordMatches = await verifyPassword(credentials.password, admin.password_hash);
  if (!passwordMatches) {
    await recordSecurityEvent(
      {
        eventType: 'login_failure',
        adminId: admin.id,
        emailAttempted: credentials.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        detail: { reason: 'wrong_password' },
      },
      context.onAuditFailure,
    );
    throw new InvalidCredentialsError();
  }
  const session = await issueSession(admin, { familyId: randomUUID2() }, context);
  await markSignedIn(admin.id);
  await recordSecurityEvent(
    {
      eventType: 'login_success',
      adminId: admin.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    },
    context.onAuditFailure,
  );
  return session;
}
async function rotateRefreshToken(presentedToken, context) {
  const presentedHash = hashRefreshToken(presentedToken);
  const outcome = await withTransaction(async (client) => {
    const stored = await findByHashIncludingRevoked(presentedHash, client);
    if (stored === void 0) {
      return { kind: 'unknown' };
    }
    if (stored.revoked_at !== null) {
      const revokedCount = await revokeFamily(stored.family_id, client);
      return {
        kind: 'replayed',
        adminId: stored.admin_id,
        familyId: stored.family_id,
        revokedCount,
      };
    }
    if (stored.expires_at.getTime() <= Date.now()) {
      await revokeToken(stored.id, client);
      return { kind: 'expired' };
    }
    const admin = await client.query(
      `select id, email, full_name from admins where id = $1 and deleted_at is null limit 1`,
      [stored.admin_id],
    );
    const adminRow = admin.rows[0];
    if (adminRow === void 0) {
      await revokeFamily(stored.family_id, client);
      return { kind: 'account_gone' };
    }
    await revokeToken(stored.id, client);
    const { token: refreshToken, tokenHash } = generateRefreshToken();
    await insertRefreshToken(
      {
        adminId: adminRow.id,
        tokenHash,
        familyId: stored.family_id,
        expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL.seconds * 1e3),
        predecessorId: stored.id,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
      },
      client,
    );
    return { kind: 'rotated', admin: adminRow, refreshToken };
  });
  if (outcome.kind === 'replayed') {
    await recordSecurityEvent(
      {
        eventType: 'session_compromised',
        adminId: outcome.adminId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        detail: { familyId: outcome.familyId, tokensRevoked: outcome.revokedCount },
      },
      context.onAuditFailure,
    );
    throw new SessionCompromisedError();
  }
  if (outcome.kind !== 'rotated') {
    throw new TokenInvalidError();
  }
  const accessToken = await signAccessToken({
    adminId: outcome.admin.id,
    email: outcome.admin.email,
  });
  return {
    admin: toAuthenticatedAdmin(outcome.admin),
    accessToken,
    refreshToken: outcome.refreshToken,
    csrfToken: generateCsrfToken(),
    expiresInSeconds: config.ACCESS_TOKEN_TTL.seconds,
  };
}
async function signOut(presentedToken, context) {
  if (presentedToken !== void 0) {
    const stored = await findByHashIncludingRevoked(hashRefreshToken(presentedToken));
    if (stored !== void 0) {
      await revokeToken(stored.id);
    }
  }
  await recordSecurityEvent(
    {
      eventType: 'logout',
      adminId: context.adminId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    },
    context.onAuditFailure,
  );
}
async function changePassword(input, context) {
  const admin = await findLiveAdminCredentialById(input.adminId);
  if (admin === void 0) {
    throw new TokenInvalidError('Your account is no longer active.');
  }
  const currentMatches = await verifyPassword(input.currentPassword, admin.password_hash);
  if (!currentMatches) {
    await recordSecurityEvent(
      {
        eventType: 'login_failure',
        adminId: admin.id,
        ipAddress: context.ipAddress,
        requestId: context.requestId,
        detail: { reason: 'wrong_current_password_on_change' },
      },
      context.onAuditFailure,
    );
    throw new InvalidCredentialsError();
  }
  const newHash = await hashPassword(input.newPassword);
  await withTransaction(async (client) => {
    await updatePasswordHash(admin.id, newHash, client);
    await revokeAllForAdmin(admin.id, client);
  });
  await recordSecurityEvent(
    {
      eventType: 'password_changed',
      adminId: admin.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    },
    context.onAuditFailure,
  );
  return issueSession(admin, { familyId: randomUUID2() }, context);
}

// src/modules/auth/auth.routes.ts
var authRouter = Router2();
function contextFrom(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
    onAuditFailure: (error) => {
      req.log.error({ err: error }, 'Failed to record security event');
    },
  };
}
function respondWithSession(res, session) {
  setAccessTokenCookie(res, session.accessToken);
  setRefreshTokenCookie(res, session.refreshToken);
  setCsrfTokenCookie(res, session.csrfToken);
  const body = {
    admin: session.admin,
    expiresIn: session.expiresInSeconds,
  };
  res.status(200).json(body);
}
authRouter.post(
  '/login',
  // Limiters run before validation so a malformed body still costs the caller
  // its allowance; otherwise the limit could be bypassed with invalid payloads.
  loginNetworkLimiter,
  loginAccountLimiter,
  validateBody(loginSchema),
  async (req, res) => {
    const session = await signIn(req.body, contextFrom(req));
    respondWithSession(res, session);
  },
);
authRouter.post('/refresh', refreshLimiter, async (req, res) => {
  const presented = readCookie(req.cookies, REFRESH_TOKEN_COOKIE);
  if (presented === void 0) {
    throw new TokenInvalidError('You are not signed in.');
  }
  try {
    const session = await rotateRefreshToken(presented, contextFrom(req));
    respondWithSession(res, session);
  } catch (error) {
    clearSessionCookies(res);
    throw error;
  }
});
authRouter.post('/logout', requireAdmin, requireCsrfToken, async (req, res) => {
  const presented = readCookie(req.cookies, REFRESH_TOKEN_COOKIE);
  await signOut(presented, { ...contextFrom(req), adminId: req.admin?.adminId });
  clearSessionCookies(res);
  res.status(204).send();
});
authRouter.get('/me', requireAdmin, (req, res) => {
  const admin = req.admin;
  if (admin === void 0) {
    throw new TokenInvalidError();
  }
  res.status(200).json({
    admin: { id: admin.adminId, email: admin.email, fullName: admin.fullName },
  });
});
authRouter.post(
  '/change-password',
  requireAdmin,
  requireCsrfToken,
  validateBody(changePasswordSchema),
  async (req, res) => {
    const admin = req.admin;
    if (admin === void 0) {
      throw new TokenInvalidError();
    }
    const { currentPassword, newPassword } = req.body;
    const session = await changePassword(
      { adminId: admin.adminId, currentPassword, newPassword },
      contextFrom(req),
    );
    respondWithSession(res, session);
  },
);

// src/modules/health/health.routes.ts
import { Router as Router3 } from 'express';
var healthRouter = Router3();
healthRouter.get('/', async (_req, res) => {
  const databaseReachable = await checkDatabaseReachable();
  res.status(databaseReachable ? 200 : 503).json({
    status: databaseReachable ? 'ok' : 'degraded',
    database: databaseReachable ? 'reachable' : 'unreachable',
  });
});

// src/modules/inquiries/inquiries.routes.ts
import { Router as Router4 } from 'express';
import { z as z10 } from 'zod';

// src/lib/csv.ts
var FORMULA_TRIGGERS = ['=', '+', '-', '@', '	', '\r'];
function neutralizeFormula(value) {
  const first = value[0];
  return first !== void 0 && FORMULA_TRIGGERS.includes(first) ? `'${value}` : value;
}
function encodeCsvField(value) {
  if (value === null || value === void 0) {
    return '';
  }
  const safe = neutralizeFormula(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
function encodeCsvRow(fields) {
  return `${fields.map(encodeCsvField).join(',')}\r
`;
}

// src/middleware/honeypot.ts
function honeypot(fieldName) {
  return (req, _res, next) => {
    const value = req.body?.[fieldName];
    const filled = typeof value === 'string' ? value.trim().length > 0 : value != null;
    if (filled) {
      req.log.info({ field: fieldName }, 'Submission rejected by honeypot');
      next(new ValidationError({ _: ['This submission could not be accepted.'] }));
      return;
    }
    next();
  };
}

// src/lib/like-escape.ts
var LIKE_ESCAPE_CHARACTER = '\\';
function escapeLikePattern(term) {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
function toContainsPattern(term) {
  return `%${escapeLikePattern(term)}%`;
}

// src/lib/cursor.ts
import { z as z9 } from 'zod';
var cursorPayloadSchema = z9.strictObject({
  /** `created_at` of the last row, as an ISO timestamp. */
  c: z9.iso.datetime({ offset: true }),
  /** `id` of the last row, breaking ties on identical timestamps. */
  i: z9.uuid(),
});
function encodeCursor(position) {
  const payload = { c: position.createdAt, i: position.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
function decodeCursor(cursor) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError({ cursor: ['The page cursor is malformed.'] });
  }
  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError({ cursor: ['The page cursor is malformed.'] });
  }
  return { createdAt: result.data.c, id: result.data.i };
}

// src/modules/inquiries/inquiries.repository.ts
var INQUIRY_COLUMNS = `
  id, user_type, category, status, full_name, email, phone, message,
  created_at, status_updated_at
`;
function toInquiry(row) {
  return {
    id: row.id,
    userType: row.user_type,
    category: row.category,
    status: row.status,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    statusUpdatedAt: row.status_updated_at?.toISOString() ?? null,
  };
}
function buildFilters(query, params) {
  const clauses = [];
  if (query.category !== void 0) {
    params.push(query.category);
    clauses.push(`category = $${params.length}`);
  }
  if (query.userType !== void 0) {
    params.push(query.userType);
    clauses.push(`user_type = $${params.length}`);
  }
  if (query.search !== void 0) {
    params.push(toContainsPattern(query.search));
    const namePattern = `$${params.length}`;
    const phoneFragment = toPhoneSearchFragment(query.search);
    if (phoneFragment === void 0) {
      clauses.push(`full_name ILIKE ${namePattern} ESCAPE '${LIKE_ESCAPE_CHARACTER}'`);
    } else {
      params.push(toContainsPattern(phoneFragment));
      clauses.push(
        `(full_name ILIKE ${namePattern} ESCAPE '${LIKE_ESCAPE_CHARACTER}' OR phone LIKE $${params.length} ESCAPE '${LIKE_ESCAPE_CHARACTER}')`,
      );
    }
  }
  return clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`;
}
async function listInquiries(query) {
  const params = [];
  const filters = buildFilters(query, params);
  let keyset = '';
  if (query.cursor !== void 0) {
    const position = decodeCursor(query.cursor);
    params.push(position.createdAt, position.id);
    keyset = ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(query.limit + 1);
  const { rows } = await pool.query(
    `select ${INQUIRY_COLUMNS}
       from inquiries
      where true${filters}${keyset}
      order by created_at desc, id desc
      limit $${params.length}`,
    params,
  );
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map(toInquiry),
    nextCursor:
      hasMore && last !== void 0
        ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
        : null,
  };
}
async function summariseInquiries(query) {
  const params = [];
  const filters = buildFilters(query, params);
  const { rows } = await pool.query(
    `select count(*) as total,
            count(*) filter (where status = 'new')         as new_count,
            count(*) filter (where status = 'in_progress') as in_progress_count,
            count(*) filter (where status = 'resolved')    as resolved_count,
            count(*) filter (where status = 'closed')      as closed_count
       from inquiries
      where true${filters}`,
    params,
  );
  const row = rows[0] ?? {
    total: 0,
    new_count: 0,
    in_progress_count: 0,
    resolved_count: 0,
    closed_count: 0,
  };
  return {
    total: row.total,
    byStatus: {
      new: row.new_count,
      in_progress: row.in_progress_count,
      resolved: row.resolved_count,
      closed: row.closed_count,
    },
  };
}
async function listInquiriesForExport(query, rowLimit) {
  const params = [];
  const filters = buildFilters(query, params);
  params.push(rowLimit + 1);
  const { rows } = await pool.query(
    `select ${INQUIRY_COLUMNS}
       from inquiries
      where true${filters}
      order by created_at desc, id desc
      limit $${params.length}`,
    params,
  );
  const truncated = rows.length > rowLimit;
  return {
    items: (truncated ? rows.slice(0, rowLimit) : rows).map(toInquiry),
    truncated,
  };
}
async function createInquiry(input, idempotencyKey, client = pool) {
  const { rows } = await client.query(
    `insert into inquiries (user_type, category, full_name, email, phone, message, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (idempotency_key) where idempotency_key is not null do nothing
     returning ${INQUIRY_COLUMNS}`,
    [
      input.userType,
      input.category,
      input.fullName,
      input.email,
      input.phone,
      input.message,
      idempotencyKey ?? null,
    ],
  );
  const inserted = rows[0];
  if (inserted !== void 0) {
    return { inquiry: toInquiry(inserted), created: true };
  }
  if (idempotencyKey === void 0) {
    throw new Error('Inquiry insert returned no row');
  }
  const existing = await client.query(
    `select ${INQUIRY_COLUMNS} from inquiries where idempotency_key = $1 limit 1`,
    [idempotencyKey],
  );
  const row = existing.rows[0];
  if (row === void 0) {
    throw new Error('Idempotent insert conflicted but the original row was not found');
  }
  return { inquiry: toInquiry(row), created: false };
}
async function updateInquiryStatus(id, status, adminId, client = pool) {
  const { rows } = await client.query(
    `update inquiries
        set status = $2, status_updated_at = now(), status_updated_by = $3
      where id = $1
      returning ${INQUIRY_COLUMNS}`,
    [id, status, adminId],
  );
  const row = rows[0];
  return row === void 0 ? void 0 : toInquiry(row);
}

// src/modules/inquiries/inquiries.routes.ts
var inquiriesRouter = Router4();
var idempotencyKeySchema = z10.uuid();
function readIdempotencyKey(headerValue) {
  if (headerValue === void 0) {
    return void 0;
  }
  const result = idempotencyKeySchema.safeParse(headerValue);
  if (!result.success) {
    throw new ValidationError({
      'X-Idempotency-Key': ['The idempotency key must be a UUID.'],
    });
  }
  return result.data;
}
inquiriesRouter.post(
  '/',
  submitLimiter,
  validateBody(createInquirySchema),
  honeypot(HONEYPOT_FIELD),
  async (req, res) => {
    const key = readIdempotencyKey(req.get('x-idempotency-key'));
    const { inquiry, created } = await createInquiry(req.body, key);
    res.status(created ? 201 : 200).json({ inquiry });
  },
);
inquiriesRouter.get(
  '/summary',
  requireAdmin,
  validateQuery(listInquiriesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery;
    res.status(200).json(await summariseInquiries(query));
  },
);
inquiriesRouter.get(
  '/export',
  requireAdmin,
  exportLimiter,
  validateQuery(listInquiriesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery;
    const admin = req.admin;
    if (admin === void 0) {
      throw new TokenInvalidError();
    }
    const { items, truncated } = await listInquiriesForExport(query, config.EXPORT_ROW_LIMIT);
    await recordSecurityEvent(
      {
        eventType: 'inquiry_exported',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        detail: { rowCount: items.length, truncated, filters: query },
      },
      (error) => req.log.error({ err: error }, 'Failed to record export event'),
    );
    const filename = `inquiries-${/* @__PURE__ */ new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (truncated) {
      res.setHeader('X-Export-Truncated', String(config.EXPORT_ROW_LIMIT));
    }
    res.write(
      encodeCsvRow([
        'Submitted at',
        'Name',
        'Email',
        'Phone',
        'User type',
        'Category',
        'Status',
        'Message',
      ]),
    );
    for (const item of items) {
      res.write(
        encodeCsvRow([
          item.createdAt,
          item.fullName,
          item.email,
          item.phone,
          USER_TYPE_LABELS[item.userType],
          INQUIRY_CATEGORY_LABELS[item.category],
          INQUIRY_STATUS_LABELS[item.status],
          item.message,
        ]),
      );
    }
    res.end();
  },
);
inquiriesRouter.get(
  '/',
  requireAdmin,
  validateQuery(listInquiriesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery;
    res.status(200).json(await listInquiries(query));
  },
);
inquiriesRouter.patch(
  '/:id/status',
  requireAdmin,
  requireCsrfToken,
  validateParams(inquiryIdParamSchema),
  validateBody(updateInquiryStatusSchema),
  async (req, res) => {
    const admin = req.admin;
    if (admin === void 0) {
      throw new TokenInvalidError();
    }
    const { id } = req.validatedParams;
    const { status } = req.body;
    const updated = await updateInquiryStatus(id, status, admin.adminId);
    if (updated === void 0) {
      throw new NotFoundError('inquiry');
    }
    await recordSecurityEvent(
      {
        eventType: 'inquiry_status_changed',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        detail: { inquiryId: id, status },
      },
      (error) => req.log.error({ err: error }, 'Failed to record status change'),
    );
    res.status(200).json({ inquiry: updated });
  },
);

// src/app.ts
function buildCorsOptions() {
  const allowed = new Set(config.CORS_ALLOWED_ORIGINS);
  return {
    origin(origin, callback) {
      if (origin === void 0 || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-Export-Truncated'],
    maxAge: 600,
  };
}
function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(
    helmet({
      // This API serves only JSON, so the policy is exactly two directives.
      // `useDefaults: false` is deliberate: helmet's default set would
      // otherwise merge in `script-src 'self'` and `style-src 'unsafe-inline'`,
      // which can never apply to a JSON response and leave an `'unsafe-inline'`
      // in the policy that a reader has to stop and reason about.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // One year, which is the minimum for preload eligibility.
      hsts: { maxAge: 31536e3, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors(buildCorsOptions()));
  app.use(compression());
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(cookieParser());
  app.use('/api/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/inquiries', inquiriesRouter);
  app.use('/api/v1/admins', adminsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
var app_default = createApp();
export { createApp, app_default as default };
