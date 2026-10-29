import { z } from 'zod';

/**
 * The single error shape every endpoint uses, per the house API contract.
 *
 * `code` is what the client branches on and never changes once published.
 * `error` is for display. `requestId` is what a user quotes in a bug report and
 * what correlates the response with the server log line that explains it.
 */
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  requestId: z.string(),
  /** Field-level messages, present only on a validation failure. */
  details: z.record(z.string(), z.array(z.string())).optional(),
});

export type ApiError = z.output<typeof apiErrorSchema>;

/**
 * Error codes the client is expected to handle by name.
 *
 * `TOKEN_EXPIRED` and `TOKEN_INVALID` are deliberately distinct: the first means
 * refresh silently and replay, the second means the session is unrecoverable and
 * the user must sign in again.
 */
export const API_ERROR_CODES = {
  validationFailed: 'VALIDATION_FAILED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  tokenExpired: 'TOKEN_EXPIRED',
  tokenInvalid: 'TOKEN_INVALID',
  sessionCompromised: 'SESSION_COMPROMISED',
  csrfTokenInvalid: 'CSRF_TOKEN_INVALID',
  notFound: 'NOT_FOUND',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  rateLimited: 'RATE_LIMITED',
  internalError: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * A keyset-paginated page.
 *
 * `nextCursor` is null on the last page, which is how the client knows to stop
 * without needing a total count. A count would cost a second full scan per page
 * and is not something the dashboard displays.
 */
export function pageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
