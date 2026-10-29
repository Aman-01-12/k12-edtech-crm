import { z } from 'zod';
import { inquiryCategorySchema, inquiryStatusSchema, userTypeSchema } from './enums.js';
import { emailSchema, fullNameSchema, messageSchema, phoneSchema } from './fields.js';
import { containsControlCharacters, TEXT_BLOCK_ALLOWED_CONTROLS } from './text.js';

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
  /** Owner, or null when nobody has picked it up. */
  assignedToAdminId: z.uuid().nullable(),
  assignedToName: z.string().nullable(),
});

export type Inquiry = z.output<typeof inquirySchema>;

/**
 * Internal staff commentary on one enquiry.
 *
 * `authorName` is stored alongside the note rather than joined, so a note still
 * says who wrote it after that account is deactivated.
 */
export const inquiryNoteSchema = z.object({
  id: z.uuid(),
  /** `reply` was emailed to the applicant; `note` is internal only. */
  kind: z.enum(['note', 'reply']),
  /** Present only on a reply. */
  subject: z.string().nullable(),
  body: z.string(),
  authorName: z.string(),
  authorAdminId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  /**
   * Whether the caller may delete this. Always false for a reply: it has
   * already left the building, so removing the record would be a lie.
   */
  deletableByViewer: z.boolean(),
});

export type InquiryNote = z.output<typeof inquiryNoteSchema>;

export const NOTE_MIN_LENGTH = 1;
export const NOTE_MAX_LENGTH = 2000;

export const createNoteSchema = z.strictObject({
  body: z
    .string()
    .trim()
    .pipe(
      z
        .string()
        .min(NOTE_MIN_LENGTH, 'Write something before saving.')
        .max(NOTE_MAX_LENGTH, `A note must be ${NOTE_MAX_LENGTH} characters or fewer.`)
        .refine(
          (value) => !containsControlCharacters(value, TEXT_BLOCK_ALLOWED_CONTROLS),
          'The note contains unsupported characters.',
        ),
    ),
});

export type CreateNote = z.output<typeof createNoteSchema>;

export const REPLY_SUBJECT_MAX_LENGTH = 200;
export const REPLY_BODY_MAX_LENGTH = 5000;

/**
 * Emailing the applicant back.
 *
 * Deliberately carries no recipient. The address is read from the enquiry row
 * named in the path, so this endpoint cannot be pointed at an arbitrary
 * mailbox and used as an open relay.
 */
export const replyToInquirySchema = z.strictObject({
  subject: z
    .string()
    .trim()
    .pipe(
      z
        .string()
        .min(1, 'Give the email a subject.')
        .max(
          REPLY_SUBJECT_MAX_LENGTH,
          `The subject must be ${REPLY_SUBJECT_MAX_LENGTH} characters or fewer.`,
        )
        // No line breaks: a newline in a header is how header injection works,
        // and a subject has no use for one.
        .refine(
          (value) => !containsControlCharacters(value),
          'The subject cannot contain line breaks.',
        ),
    ),

  body: z
    .string()
    .trim()
    .pipe(
      z
        .string()
        .min(1, 'Write the message before sending.')
        .max(
          REPLY_BODY_MAX_LENGTH,
          `The message must be ${REPLY_BODY_MAX_LENGTH} characters or fewer.`,
        )
        .refine(
          (value) => !containsControlCharacters(value, TEXT_BLOCK_ALLOWED_CONTROLS),
          'The message contains unsupported characters.',
        ),
    ),
});

export type ReplyToInquiry = z.output<typeof replyToInquirySchema>;

/**
 * Reassigning an enquiry. `null` unassigns it, which is a real action rather
 * than an absent value, so the field is required and explicitly nullable.
 */
export const assignInquirySchema = z.strictObject({
  assignedToAdminId: z.uuid().nullable(),
});

export type AssignInquiry = z.output<typeof assignInquirySchema>;

/**
 * One entry in an enquiry's history, read from the append-only security log
 * rather than a second history table.
 */
export const inquiryTimelineEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(['status_changed', 'assigned', 'note_added', 'note_deleted', 'replied']),
  actorName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Human-readable summary, assembled server-side from the event detail. */
  summary: z.string(),
});

export type InquiryTimelineEntry = z.output<typeof inquiryTimelineEntrySchema>;

/** Everything the detail panel needs, in one round trip. */
export const inquiryDetailSchema = z.object({
  inquiry: inquirySchema,
  notes: z.array(inquiryNoteSchema),
  timeline: z.array(inquiryTimelineEntrySchema),
});

export type InquiryDetail = z.output<typeof inquiryDetailSchema>;

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

export const inquiryNoteParamsSchema = z.strictObject({
  id: z.uuid('Inquiry id must be a UUID.'),
  noteId: z.uuid('Note id must be a UUID.'),
});
