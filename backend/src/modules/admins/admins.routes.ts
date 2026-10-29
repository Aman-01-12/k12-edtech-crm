import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { createAdminSchema, type AdminSummary, type CreateAdmin } from '@k12/contracts';
import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  TokenInvalidError,
  ValidationError,
} from '../../errors/app-error.js';
import { requireCsrfToken } from '../../middleware/csrf.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { withTransaction } from '../../db/transaction.js';
import {
  insertAdmin,
  listLiveAdmins,
  softDeleteAdmin,
  type AdminRecord,
} from '../auth/admin.repository.js';
import { hashPassword } from '../auth/password.js';
import { revokeAllForAdmin } from '../auth/refresh-token.repository.js';
import { recordSecurityEvent } from '../auth/security-event.repository.js';

/**
 * Admin account management.
 *
 * Every admin can manage admins; see docs/adr/0010. The two guards here prevent
 * accidents rather than attacks.
 */
export const adminsRouter = Router();

const adminIdParamSchema = z.strictObject({ id: z.uuid('Admin id must be a UUID.') });

/** Characters chosen to avoid the pairs people mistranscribe from a screen. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
const GENERATED_PASSWORD_LENGTH = 24;

/**
 * Generates an initial password.
 *
 * Rejection-free modulo bias avoidance is not worth the complexity at this
 * alphabet size, so bytes are drawn generously and mapped; the resulting
 * entropy is far beyond what a 24-character password needs.
 */
function generateInitialPassword(): string {
  const bytes = randomBytes(GENERATED_PASSWORD_LENGTH * 2);
  let password = '';
  for (let i = 0; password.length < GENERATED_PASSWORD_LENGTH; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) {
      break;
    }
    // Skip values in the biased tail rather than folding them in.
    if (byte < 256 - (256 % PASSWORD_ALPHABET.length)) {
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return password;
}

function toSummary(record: AdminRecord): AdminSummary {
  return {
    id: record.id,
    email: record.email,
    fullName: record.full_name,
    lastLoginAt: record.last_login_at?.toISOString() ?? null,
    createdAt: record.created_at.toISOString(),
  };
}

adminsRouter.get('/', requireAdmin, async (_req, res) => {
  const admins = await listLiveAdmins();
  res.status(200).json({ admins: admins.map(toSummary) });
});

adminsRouter.post(
  '/',
  requireAdmin,
  requireCsrfToken,
  validateBody(createAdminSchema),
  async (req, res) => {
    const actor = req.admin;
    if (actor === undefined) {
      throw new TokenInvalidError();
    }

    const { email, fullName } = req.body as CreateAdmin;
    const password = generateInitialPassword();
    const created = await insertAdmin({
      email,
      fullName,
      passwordHash: await hashPassword(password),
    });

    if (created === undefined) {
      throw new ConflictError('An active account already uses that email address.');
    }

    await recordSecurityEvent(
      {
        eventType: 'admin_account_changed',
        adminId: actor.adminId,
        requestId: req.requestId,
        ipAddress: req.ip,
        detail: { action: 'created', targetAdminId: created.id },
      },
      (error) => req.log.error({ err: error }, 'Failed to record admin creation'),
    );

    // The only time the plaintext exists outside this function. It is not
    // stored in a retrievable form and is never logged.
    res.status(201).json({ admin: toSummary(created), initialPassword: password });
  },
);

adminsRouter.delete(
  '/:id',
  requireAdmin,
  requireCsrfToken,
  validateParams(adminIdParamSchema),
  async (req, res) => {
    const actor = req.admin;
    if (actor === undefined) {
      throw new TokenInvalidError();
    }

    const { id } = req.validatedParams as { id: string };

    // Checked before anything is written, so the last administrator cannot lock
    // everyone out with one click.
    if (id === actor.adminId) {
      throw new ValidationError({ id: ['You cannot deactivate your own account.'] });
    }

    const deactivated = await withTransaction(async (client) => {
      const removed = await softDeleteAdmin(id, client);
      if (removed) {
        // In the same transaction, so access stops immediately rather than at
        // the next token expiry.
        await revokeAllForAdmin(id, client);
      }
      return removed;
    });

    if (!deactivated) {
      throw new NotFoundError('admin account');
    }

    await recordSecurityEvent(
      {
        eventType: 'admin_account_changed',
        adminId: actor.adminId,
        requestId: req.requestId,
        ipAddress: req.ip,
        detail: { action: 'deactivated', targetAdminId: id },
      },
      (error) => req.log.error({ err: error }, 'Failed to record admin deactivation'),
    );

    res.status(204).send();
  },
);
