import { z } from 'zod';
import { inquiryCategorySchema, inquiryStatusSchema, userTypeSchema } from './enums.js';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/**
 * An HTML form submits a cleared `<select>` as an empty string, which is the
 * query-string spelling of "no filter" rather than an invalid filter value.
 * Everything other than the empty string is passed through untouched, so a
 * genuinely out-of-set value still fails validation.
 */
function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/**
 * The dashboard list query.
 *
 * Strict, so a misspelled parameter such as `?userTyp=parent` is a 400 rather
 * than a silently unfiltered result set, which is the failure mode that looks
 * like a working filter but is not.
 */
export const listInquiriesQuerySchema = z.strictObject({
  category: z.preprocess(emptyToUndefined, inquiryCategorySchema.optional()),
  userType: z.preprocess(emptyToUndefined, userTypeSchema.optional()),
  status: z.preprocess(emptyToUndefined, inquiryStatusSchema.optional()),

  /**
   * An admin's id, or the literal `unassigned`. A sentinel rather than an
   * empty string, because "nobody owns this" is a filter a staff member
   * actually wants, and an empty value already means "no filter at all".
   */
  assignedTo: z.preprocess(
    emptyToUndefined,
    z.union([z.literal('unassigned'), z.uuid('Assignee must be an admin id.')]).optional(),
  ),

  search: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .min(SEARCH_MIN_LENGTH, `Search needs at least ${SEARCH_MIN_LENGTH} characters.`)
      .max(SEARCH_MAX_LENGTH, `Search must be ${SEARCH_MAX_LENGTH} characters or fewer.`)
      .optional(),
  ),

  /** Opaque keyset page marker produced by a previous response. */
  cursor: z.preprocess(emptyToUndefined, z.base64url('Malformed page cursor.').optional()),

  limit: z.coerce
    .number()
    .int('Limit must be a whole number.')
    .min(1, 'Limit must be at least 1.')
    .max(PAGE_SIZE_MAX, `Limit must be ${PAGE_SIZE_MAX} or fewer.`)
    .default(PAGE_SIZE_DEFAULT),
});

export type ListInquiriesQuery = z.output<typeof listInquiriesQuerySchema>;
