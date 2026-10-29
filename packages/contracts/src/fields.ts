import { z } from 'zod';
import { normalizeIndianPhone } from './phone.js';
import {
  collapseWhitespace,
  containsControlCharacters,
  TEXT_BLOCK_ALLOWED_CONTROLS,
  utf8ByteLength,
} from './text.js';

/**
 * Reusable field schemas.
 *
 * Each one validates and normalizes, so a value that leaves a schema is already
 * in the shape the database column expects. The frontend and the backend import
 * the same schemas, which is what keeps client-side feedback and server-side
 * enforcement from drifting apart.
 */

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 254;
export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 2000;

/**
 * bcrypt hashes at most the first 72 bytes of its input and silently discards
 * the rest, so two passwords sharing a 72-byte prefix would be interchangeable.
 * Rejecting longer input is OWASP's guidance and keeps that from being possible.
 */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Order matters here: normalization runs before the control-character check, so
 * whitespace controls such as a pasted line break are collapsed to a space
 * rather than rejected, while controls normalization cannot remove, such as a
 * bidirectional override or a null byte, are still errors.
 */
export const fullNameSchema = z
  .string()
  .trim()
  .transform(collapseWhitespace)
  .pipe(
    z
      .string()
      .min(FULL_NAME_MIN_LENGTH, `Name must be at least ${FULL_NAME_MIN_LENGTH} characters.`)
      .max(FULL_NAME_MAX_LENGTH, `Name must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`)
      .refine(
        (value) => !containsControlCharacters(value),
        'Name contains unsupported characters.',
      ),
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email('Enter a valid email address.')
      .max(EMAIL_MAX_LENGTH, `Email must be ${EMAIL_MAX_LENGTH} characters or fewer.`),
  );

export const phoneSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    const normalized = normalizeIndianPhone(raw);
    if (normalized === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid 10-digit Indian mobile number.',
      });
      return z.NEVER;
    }
    return normalized;
  });

export const messageSchema = z
  .string()
  .trim()
  .pipe(
    z
      .string()
      .min(MESSAGE_MIN_LENGTH, `Message must be at least ${MESSAGE_MIN_LENGTH} characters.`)
      .max(MESSAGE_MAX_LENGTH, `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`)
      .refine(
        (value) => !containsControlCharacters(value, TEXT_BLOCK_ALLOWED_CONTROLS),
        'Message contains unsupported characters.',
      ),
  );

/**
 * The password field as accepted at login.
 *
 * Deliberately free of complexity rules: enforcing them here would let an
 * attacker learn the policy, and would reject a legitimate credential that
 * predates the current policy. Only the bcrypt input limit is enforced.
 */
export const loginPasswordSchema = z
  .string()
  .min(1, 'Enter your password.')
  .refine(
    (value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES,
    `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.`,
  );

/** The password field as accepted when provisioning an admin account. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .refine(
    (value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES,
    `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.`,
  )
  .refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter.')
  .refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password must contain a digit.');
