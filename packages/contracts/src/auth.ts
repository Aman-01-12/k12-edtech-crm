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

/**
 * Admin provisioning input, used only by the seeding script.
 *
 * Unlike sign-in this does enforce password strength, because here the password
 * is being chosen rather than checked.
 */
export const provisionAdminSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters.')
    .max(120, 'Full name must be 120 characters or fewer.'),
});

export type ProvisionAdmin = z.output<typeof provisionAdminSchema>;
