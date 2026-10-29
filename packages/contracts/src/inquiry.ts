import { z } from 'zod';
import { inquiryCategorySchema, inquiryStatusSchema, userTypeSchema } from './enums.js';
import { emailSchema, fullNameSchema, messageSchema, phoneSchema } from './fields.js';

/**
 * The public submission body.
 *
 * Strict rather than permissive: a body carrying a field the API does not define
 * is rejected instead of silently stripped. A caller sending an unexpected key is
 * either confused or probing for a mass-assignment path, and both deserve a 400.
 */
export const createInquirySchema = z.strictObject({
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
  website: z.string().max(200).optional(),
});

/** The honeypot field name, shared so the form and the check cannot diverge. */
export const HONEYPOT_FIELD = 'website' as const;

/** What the client sends, before normalization. */
export type CreateInquiryInput = z.input<typeof createInquirySchema>;

/** What the service receives, normalized and ready for the database. */
export type CreateInquiry = z.output<typeof createInquirySchema>;

/**
 * One inquiry as the dashboard reads it.
 *
 * Mirrors exactly the columns the list query names, so a column added to the
 * table does not silently widen the API response.
 */
export const inquirySchema = z.object({
  id: z.uuid(),
  userType: userTypeSchema,
  category: inquiryCategorySchema,
  status: inquiryStatusSchema,
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  message: z.string(),
  createdAt: z.iso.datetime(),
  statusUpdatedAt: z.iso.datetime().nullable(),
});

export type Inquiry = z.output<typeof inquirySchema>;

/**
 * The status-change body.
 *
 * Strict for the same reason as the submission schema, and carrying only the one
 * field, so this endpoint cannot be used to write any other column.
 */
export const updateInquiryStatusSchema = z.strictObject({
  status: inquiryStatusSchema,
});

export type UpdateInquiryStatus = z.output<typeof updateInquiryStatusSchema>;

/** The id path parameter, validated so a malformed id never reaches a query. */
export const inquiryIdParamSchema = z.strictObject({
  id: z.uuid('Inquiry id must be a UUID.'),
});
