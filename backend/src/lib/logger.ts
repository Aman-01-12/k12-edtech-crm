import { pino } from 'pino';
import { config } from '../config/env.js';

/**
 * Structured application logger.
 *
 * Two rules shape this configuration.
 *
 * Credentials and tokens are redacted at the logger rather than at each call
 * site, because a redaction that depends on every author remembering it is not
 * a control. The paths below cover the places a secret could plausibly arrive:
 * request bodies, headers, and cookies.
 *
 * Personal data from an inquiry is never logged at all. Inquiries are
 * referenced by id, which is why there is no redaction path for a submitter's
 * name, email or phone: those values must not reach a log line in the first
 * place.
 */

/** Values replaced with a placeholder wherever they appear. */
const REDACTED_PATHS = [
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

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  // Epoch milliseconds in production so a log aggregator parses it without a
  // custom format; readable local time in development.
  timestamp: config.isProduction ? pino.stdTimeFunctions.epochTime : pino.stdTimeFunctions.isoTime,
  base: { service: 'k12-edtech-crm-api' },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = typeof logger;
