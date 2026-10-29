import { pino } from 'pino';
import { config } from '../config/env.js';

/**
 * Redaction is configured at the logger, not at each call site, because a
 * control that depends on every author remembering it is not a control.
 *
 * An inquiry's personal data has no path here at all: inquiries are referenced
 * by id, which is why there is no redaction entry for a submitter's name,
 * email or phone.
 */
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
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  // Epoch in production so an aggregator parses it without a custom format.
  timestamp: config.isProduction ? pino.stdTimeFunctions.epochTime : pino.stdTimeFunctions.isoTime,
  base: { service: 'k12-edtech-crm-api' },
  formatters: { level: (label) => ({ level: label }) },
});

export type Logger = typeof logger;
