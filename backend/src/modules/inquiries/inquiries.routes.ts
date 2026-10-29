import { Router } from 'express';
import {
  INQUIRY_CATEGORY_LABELS,
  INQUIRY_STATUS_LABELS,
  USER_TYPE_LABELS,
  createInquirySchema,
  HONEYPOT_FIELD,
  inquiryIdParamSchema,
  listInquiriesQuerySchema,
  updateInquiryStatusSchema,
  type CreateInquiry,
  type ListInquiriesQuery,
  type UpdateInquiryStatus,
} from '@k12/contracts';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { NotFoundError, TokenInvalidError, ValidationError } from '../../errors/app-error.js';
import { encodeCsvRow } from '../../lib/csv.js';
import { requireCsrfToken } from '../../middleware/csrf.js';
import { honeypot } from '../../middleware/honeypot.js';
import { exportLimiter, submitLimiter } from '../../middleware/rate-limit.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { recordSecurityEvent } from '../auth/security-event.repository.js';
import {
  createInquiry,
  listInquiries,
  listInquiriesForExport,
  summariseInquiries,
  updateInquiryStatus,
} from './inquiries.repository.js';

export const inquiriesRouter = Router();

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

inquiriesRouter.patch(
  '/:id/status',
  requireAdmin,
  requireCsrfToken,
  validateParams(inquiryIdParamSchema),
  validateBody(updateInquiryStatusSchema),
  async (req, res) => {
    const admin = req.admin;
    if (admin === undefined) {
      throw new TokenInvalidError();
    }

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
        detail: { inquiryId: id, status },
      },
      (error) => req.log.error({ err: error }, 'Failed to record status change'),
    );

    res.status(200).json({ inquiry: updated });
  },
);
