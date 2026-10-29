import { Router } from 'express';
import {
  INQUIRY_CATEGORY_LABELS,
  INQUIRY_STATUS_LABELS,
  USER_TYPE_LABELS,
  assignInquirySchema,
  createInquirySchema,
  createNoteSchema,
  HONEYPOT_FIELD,
  inquiryIdParamSchema,
  inquiryNoteParamsSchema,
  listInquiriesQuerySchema,
  updateInquiryStatusSchema,
  type AssignInquiry,
  type CreateInquiry,
  type CreateNote,
  type ListInquiriesQuery,
  type UpdateInquiryStatus,
} from '@k12/contracts';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { NotFoundError, TokenInvalidError, ValidationError } from '../../errors/app-error.js';
import { findLiveAdminById } from '../auth/admin.repository.js';
import type { AuthenticatedAdminPrincipal } from '../../middleware/require-admin.js';
import { encodeCsvRow } from '../../lib/csv.js';
import { requireCsrfToken } from '../../middleware/csrf.js';
import { honeypot } from '../../middleware/honeypot.js';
import { exportLimiter, submitLimiter } from '../../middleware/rate-limit.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { recordSecurityEvent } from '../auth/security-event.repository.js';
import {
  assignInquiry,
  createInquiry,
  deleteInquiryNote,
  findInquiryById,
  insertInquiryNote,
  listInquiries,
  listInquiriesForExport,
  listInquiryNotes,
  listInquiryTimeline,
  summariseInquiries,
  updateInquiryStatus,
} from './inquiries.repository.js';

export const inquiriesRouter = Router();

/**
 * `requireAdmin` guarantees this, but it cannot say so in the type. Narrowing
 * here once keeps the same three-line guard out of every protected handler.
 */
function requireAdminPrincipal(req: { admin?: AuthenticatedAdminPrincipal }) {
  const admin = req.admin;
  if (admin === undefined) {
    throw new TokenInvalidError();
  }
  return admin;
}

/** Optional client key making a retried submission idempotent. */
const idempotencyKeySchema = z.uuid();

function readIdempotencyKey(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined) {
    return undefined;
  }
  const result = idempotencyKeySchema.safeParse(headerValue);
  if (!result.success) {
    throw new ValidationError({
      'X-Idempotency-Key': ['The idempotency key must be a UUID.'],
    });
  }
  return result.data;
}

inquiriesRouter.post(
  '/',
  submitLimiter,
  validateBody(createInquirySchema),
  honeypot(HONEYPOT_FIELD),
  async (req, res) => {
    const key = readIdempotencyKey(req.get('x-idempotency-key'));
    const { inquiry, created } = await createInquiry(req.body as CreateInquiry, key);

    // 200 on a replay rather than 201, so the client can tell a retry that was
    // recognised from a submission that was newly stored.
    res.status(created ? 201 : 200).json({ inquiry });
  },
);

/**
 * Registered before any `/:id` route, or Express would match `summary` and
 * `export` as an inquiry id and the UUID schema would reject them with a
 * confusing validation error instead of routing correctly.
 */
inquiriesRouter.get(
  '/summary',
  requireAdmin,
  validateQuery(listInquiriesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery as ListInquiriesQuery;
    res.status(200).json(await summariseInquiries(query));
  },
);

inquiriesRouter.get(
  '/export',
  requireAdmin,
  exportLimiter,
  validateQuery(listInquiriesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery as ListInquiriesQuery;
    const admin = req.admin;
    if (admin === undefined) {
      throw new TokenInvalidError();
    }

    const { items, truncated } = await listInquiriesForExport(query, config.EXPORT_ROW_LIMIT);

    await recordSecurityEvent(
      {
        eventType: 'inquiry_exported',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        detail: { rowCount: items.length, truncated, filters: query },
      },
      (error) => req.log.error({ err: error }, 'Failed to record export event'),
    );

    const filename = `inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (truncated) {
      res.setHeader('X-Export-Truncated', String(config.EXPORT_ROW_LIMIT));
    }

    res.write(
      encodeCsvRow([
        'Submitted at',
        'Name',
        'Email',
        'Phone',
        'User type',
        'Category',
        'Status',
        'Message',
      ]),
    );
    for (const item of items) {
      res.write(
        encodeCsvRow([
          item.createdAt,
          item.fullName,
          item.email,
          item.phone,
          USER_TYPE_LABELS[item.userType],
          INQUIRY_CATEGORY_LABELS[item.category],
          INQUIRY_STATUS_LABELS[item.status],
          item.message,
        ]),
      );
    }
    res.end();
  },
);

inquiriesRouter.get(
  '/',
  requireAdmin,
  validateQuery(listInquiriesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery as ListInquiriesQuery;
    res.status(200).json(await listInquiries(query));
  },
);

/** The detail panel's one round trip: the enquiry, its notes and its history. */
inquiriesRouter.get(
  '/:id',
  requireAdmin,
  validateParams(inquiryIdParamSchema),
  async (req, res) => {
    const admin = requireAdminPrincipal(req);
    const { id } = req.validatedParams as { id: string };

    const inquiry = await findInquiryById(id);
    if (inquiry === undefined) {
      throw new NotFoundError('inquiry');
    }

    const [notes, timeline] = await Promise.all([
      listInquiryNotes(id, admin.adminId),
      listInquiryTimeline(id),
    ]);

    res.status(200).json({ inquiry, notes, timeline });
  },
);

inquiriesRouter.patch(
  '/:id/status',
  requireAdmin,
  requireCsrfToken,
  validateParams(inquiryIdParamSchema),
  validateBody(updateInquiryStatusSchema),
  async (req, res) => {
    const admin = requireAdminPrincipal(req);
    const { id } = req.validatedParams as { id: string };
    const { status } = req.body as UpdateInquiryStatus;

    const updated = await updateInquiryStatus(id, status, admin.adminId);
    if (updated === undefined) {
      throw new NotFoundError('inquiry');
    }

    await recordSecurityEvent(
      {
        eventType: 'inquiry_status_changed',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        detail: { inquiryId: id, status, previousStatus: updated.previousStatus },
      },
      (error) => req.log.error({ err: error }, 'Failed to record status change'),
    );

    res.status(200).json({ inquiry: updated.inquiry });
  },
);

/** Set or clear the owner. A null id unassigns. */
inquiriesRouter.patch(
  '/:id/assignment',
  requireAdmin,
  requireCsrfToken,
  validateParams(inquiryIdParamSchema),
  validateBody(assignInquirySchema),
  async (req, res) => {
    const admin = requireAdminPrincipal(req);
    const { id } = req.validatedParams as { id: string };
    const { assignedToAdminId } = req.body as AssignInquiry;

    // Checked before the write so assigning to a deactivated or nonexistent
    // account is a 400 rather than a foreign-key error surfacing as a 500.
    if (assignedToAdminId !== null) {
      const assignee = await findLiveAdminById(assignedToAdminId);
      if (assignee === undefined) {
        throw new ValidationError({
          assignedToAdminId: ['That admin account does not exist or is no longer active.'],
        });
      }
    }

    const updated = await assignInquiry(id, assignedToAdminId);
    if (updated === undefined) {
      throw new NotFoundError('inquiry');
    }

    await recordSecurityEvent(
      {
        eventType: 'inquiry_assigned',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        detail: {
          inquiryId: id,
          assignedToAdminId,
          assignedToName: updated.assignedToName,
        },
      },
      (error) => req.log.error({ err: error }, 'Failed to record assignment'),
    );

    res.status(200).json({ inquiry: updated });
  },
);

inquiriesRouter.post(
  '/:id/notes',
  requireAdmin,
  requireCsrfToken,
  validateParams(inquiryIdParamSchema),
  validateBody(createNoteSchema),
  async (req, res) => {
    const admin = requireAdminPrincipal(req);
    const { id } = req.validatedParams as { id: string };
    const { body } = req.body as CreateNote;

    // Confirms the enquiry exists before writing, so a note cannot be attached
    // to an id that was never there.
    const inquiry = await findInquiryById(id);
    if (inquiry === undefined) {
      throw new NotFoundError('inquiry');
    }

    const note = await insertInquiryNote({
      inquiryId: id,
      adminId: admin.adminId,
      authorName: admin.fullName,
      body,
    });

    await recordSecurityEvent(
      {
        eventType: 'inquiry_note_added',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        // The note's own text is deliberately absent: the security log is not
        // where third-party personal data belongs.
        detail: { inquiryId: id, noteId: note.id },
      },
      (error) => req.log.error({ err: error }, 'Failed to record note'),
    );

    res.status(201).json({ note });
  },
);

/**
 * Deletes a note. Authors only.
 *
 * The ownership check is a predicate in the DELETE statement, so there is no
 * gap between checking and writing, and "not yours" is answered identically to
 * "no such note" so the response cannot confirm someone else's note exists.
 */
inquiriesRouter.delete(
  '/:id/notes/:noteId',
  requireAdmin,
  requireCsrfToken,
  validateParams(inquiryNoteParamsSchema),
  async (req, res) => {
    const admin = requireAdminPrincipal(req);
    const { id, noteId } = req.validatedParams as { id: string; noteId: string };

    const deleted = await deleteInquiryNote({ noteId, inquiryId: id, adminId: admin.adminId });
    if (!deleted) {
      throw new NotFoundError('note');
    }

    await recordSecurityEvent(
      {
        eventType: 'inquiry_note_deleted',
        adminId: admin.adminId,
        ipAddress: req.ip,
        requestId: req.requestId,
        detail: { inquiryId: id, noteId },
      },
      (error) => req.log.error({ err: error }, 'Failed to record note deletion'),
    );

    res.status(204).send();
  },
);
