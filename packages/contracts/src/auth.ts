import { z } from 'zod';
import { emailSchema, loginPasswordSchema, newPasswordSchema } from './fields.js';

/**
 * Sign-in credentials.
 *
 * The email is normalized the same way the stored column is indexed, so a
 * difference in case or surrounding whitespace cannot cause a false mismatch.
 */
export const loginSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
});

export type LoginInput = z.input<typeof loginSchema>;
export type LoginCredentials = z.output<typeof loginSchema>;

/** The signed-in admin as returned by sign-in and by the session endpoint. */
export const authenticatedAdminSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
});

export type AuthenticatedAdmin = z.output<typeof authenticatedAdminSchema>;

/**
 * The sign-in response.
 *
 * Carries no token: both tokens travel in `HttpOnly` cookies the client cannot
 * read. `expiresIn` is the access token's lifetime in seconds, so the client can
 * refresh ahead of expiry rather than waiting for a 401.
 */
export const loginResponseSchema = z.object({
  admin: authenticatedAdminSchema,
  expiresIn: z.number().int().positive(),
});

export type LoginResponse = z.output<typeof loginResponseSchema>;

/** A full name, as used for an admin account. */
const adminFullNameSchema = z
  .string()
  .trim()
  .min(2, 'Full name must be at least 2 characters.')
  .max(120, 'Full name must be 120 characters or fewer.');

/**
 * Admin provisioning input, used by the seeding script.
 *
 * Unlike sign-in this does enforce password strength, because here the password
 * is being chosen rather than checked.
 */
export const provisionAdminSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  fullName: adminFullNameSchema,
});

export type ProvisionAdmin = z.output<typeof provisionAdminSchema>;

/**
 * Creating an admin through the API.
 *
 * No password field: the server generates one and returns it exactly once, so a
 * weak password cannot be chosen for someone else and the plaintext never has
 * to travel in a request body.
 */
export const createAdminSchema = z.strictObject({
  email: emailSchema,
  fullName: adminFullNameSchema,
});

export type CreateAdmin = z.output<typeof createAdminSchema>;

/**
 * Changing one's own password.
 *
 * The current password is required, so possession of a session is not by itself
 * enough to change the credential that session was established with.
 */
export const changePasswordSchema = z.strictObject({
  currentPassword: loginPasswordSchema,
  newPassword: newPasswordSchema,
});

export type ChangePassword = z.output<typeof changePasswordSchema>;

/**
 * Requesting a password-reset email.
 *
 * No other field: the response is identical whether or not the address has an
 * account, so there is nothing else for this request to usefully carry.
 */
export const forgotPasswordSchema = z.strictObject({
  email: emailSchema,
});

export type ForgotPassword = z.output<typeof forgotPasswordSchema>;

/**
 * Redeeming a password-reset link.
 *
 * `token` is opaque to this schema; its validity is checked against the
 * database, not by shape. The new password goes through the strong-password
 * schema, the same as any other newly chosen password.
 */
export const resetPasswordSchema = z.strictObject({
  token: z.string().min(1, 'This reset link is missing its token.'),
  newPassword: newPasswordSchema,
});

export type ResetPassword = z.output<typeof resetPasswordSchema>;

/** An admin account as the management screen lists them. */
export const adminSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type AdminSummary = z.output<typeof adminSummarySchema>;
