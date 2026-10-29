import { z } from 'zod';

/**
 * The only module that reads `process.env`.
 *
 * Configuration is parsed once at startup and exported frozen. A missing or
 * malformed variable aborts the process with a message naming it, rather than
 * surfacing much later as a confusing failure on the first request that needs
 * it. An ESLint rule forbids reading `process.env` anywhere else, so this
 * guarantee cannot be quietly bypassed.
 */

/** The minimum signing-key length that makes an HS256 secret worth having. */
const JWT_SECRET_MIN_BYTES = 32;

/** OWASP's floor for bcrypt. Lower is not acceptable, so it is not accepted. */
const BCRYPT_COST_MIN = 12;
const BCRYPT_COST_MAX = 15;

/**
 * Parses a duration such as `15m` or `7d` into seconds.
 *
 * Token lifetimes are configured as durations because that is how a human
 * reasons about them, but every consumer needs seconds: the JWT `exp` claim,
 * the cookie `Max-Age`, and the `expiresIn` the client is told. Converting once
 * here is what stops those three drifting apart.
 */
function parseDurationToSeconds(value: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const secondsPerUnit = { s: 1, m: 60, h: 3600, d: 86_400 } as const;
  if (unit !== 's' && unit !== 'm' && unit !== 'h' && unit !== 'd') {
    return undefined;
  }
  return amount * secondsPerUnit[unit];
}

/** A duration string, carried alongside the seconds every consumer actually needs. */
const durationSchema = z.string().transform((value, ctx) => {
  const seconds = parseDurationToSeconds(value);
  if (seconds === undefined || seconds <= 0) {
    ctx.addIssue({
      code: 'custom',
      message: `Expected a positive duration such as 15m, 2h or 7d, received ${JSON.stringify(value)}.`,
    });
    return z.NEVER;
  }
  return { raw: value, seconds };
});

/** A comma-separated allowlist, normalized to a deduplicated array. */
const originListSchema = z.string().transform((value) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  ),
);

const positiveIntSchema = z.coerce.number().int().positive();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveIntSchema.max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  DATABASE_POOL_MAX: positiveIntSchema.max(50).default(5),
  DATABASE_CONNECTION_TIMEOUT_MS: positiveIntSchema.default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: positiveIntSchema.default(8_000),

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

  RATE_LIMIT_SUBMIT_WINDOW_MS: positiveIntSchema.default(60_000),
  RATE_LIMIT_SUBMIT_MAX: positiveIntSchema.default(5),
  RATE_LIMIT_LOGIN_WINDOW_MS: positiveIntSchema.default(900_000),
  // Failed attempts against one account. Within NCSC's 5-to-10 guidance for a
  // lockout threshold, except this is a self-healing window rather than a
  // lockout, so it cannot be used to deny a real user access indefinitely.
  RATE_LIMIT_LOGIN_MAX: positiveIntSchema.default(10),
  // Failed attempts from one network, which is what catches credential
  // stuffing across many accounts. Higher than the per-account limit because
  // a school or office shares one address.
  RATE_LIMIT_LOGIN_NETWORK_MAX: positiveIntSchema.default(50),
  RATE_LIMIT_REFRESH_WINDOW_MS: positiveIntSchema.default(900_000),
  RATE_LIMIT_REFRESH_MAX: positiveIntSchema.default(60),
  RATE_LIMIT_EXPORT_WINDOW_MS: positiveIntSchema.default(900_000),
  RATE_LIMIT_EXPORT_MAX: positiveIntSchema.default(10),

  // Both keyed on network, not on the submitted email: keying the request step
  // on the email would let an attacker tell a rate-limited address from a
  // fresh one, which is exactly the existence signal the generic response is
  // trying to avoid.
  RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS: positiveIntSchema.default(900_000),
  RATE_LIMIT_FORGOT_PASSWORD_MAX: positiveIntSchema.default(5),
  RATE_LIMIT_RESET_PASSWORD_WINDOW_MS: positiveIntSchema.default(900_000),
  RATE_LIMIT_RESET_PASSWORD_MAX: positiveIntSchema.default(10),

  EXPORT_ROW_LIMIT: positiveIntSchema.max(50_000).default(5_000),

  // No default for any of these four: a password-reset email is security
  // sensitive, so a half-configured deployment should refuse to start rather
  // than silently fail to send, or send from an unverified address.
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required.'),
  RESEND_FROM_EMAIL: z
    .string()
    .min(3, 'RESEND_FROM_EMAIL is required.')
    .refine((value) => value.includes('@'), 'RESEND_FROM_EMAIL must contain an address.'),
  PASSWORD_RESET_TOKEN_TTL: durationSchema.prefault('1h'),
  // The frontend origin, used to build the link inside the reset email. Kept
  // distinct from CORS_ALLOWED_ORIGINS, which is a list and exists to decide
  // which origins may call the API, not to construct a URL.
  APP_BASE_URL: z
    .url('APP_BASE_URL must be a valid URL, such as https://example.com.')
    .transform((value) => value.replace(/\/+$/, '')),
});

/**
 * Reads and validates the environment.
 *
 * Empty strings are treated as absent so that a variable left blank in a `.env`
 * file falls back to its default instead of failing as a malformed value, which
 * is what a reader of that file would expect.
 */
function loadConfig(): AppConfig {
  const present: Record<string, string> = {};
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
    // Written straight to stderr rather than through the logger, because the
    // logger's own level comes from the configuration that just failed.
    process.stderr.write(
      `Invalid environment configuration. The server will not start.\n${problems}\n\nSee .env.example for the required variables.\n`,
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

type ParsedEnvironment = z.output<typeof environmentSchema>;

export interface AppConfig extends ParsedEnvironment {
  /** Drives cookie `Secure` flags and error verbosity. */
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

export const config: AppConfig = loadConfig();

export { parseDurationToSeconds };
