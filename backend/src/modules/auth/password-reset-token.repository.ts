import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

export interface PasswordResetTokenRecord extends Record<string, unknown> {
  id: string;
  admin_id: string;
  expires_at: Date;
  used_at: Date | null;
}

export async function insertPasswordResetToken(
  input: { adminId: string; tokenHash: Buffer; expiresAt: Date },
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    `insert into password_reset_tokens (admin_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [input.adminId, input.tokenHash, input.expiresAt],
  );
}

/**
 * Returns used and expired rows too, so the caller rejects all three failure
 * modes with one indistinguishable error rather than letting the absence of a
 * row mean something different from a spent one.
 */
export async function findResetTokenByHash(
  tokenHash: Buffer,
  client: Queryable = pool,
): Promise<PasswordResetTokenRecord | undefined> {
  const { rows } = await client.query<PasswordResetTokenRecord>(
    `select id, admin_id, expires_at, used_at
       from password_reset_tokens
      where token_hash = $1
      limit 1`,
    [tokenHash],
  );
  return rows[0];
}

/** Guarded on `used_at is null`, so two concurrent redemptions cannot both win. */
export async function markResetTokenUsed(id: string, client: Queryable = pool): Promise<boolean> {
  const { rowCount } = await client.query(
    `update password_reset_tokens set used_at = now() where id = $1 and used_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Invalidates any outstanding token for an admin, so issuing a new link
 * silently retires the previous one rather than leaving several live at once.
 */
export async function invalidateOutstandingResetTokens(
  adminId: string,
  client: Queryable = pool,
): Promise<number> {
  const { rowCount } = await client.query(
    `update password_reset_tokens set used_at = now() where admin_id = $1 and used_at is null`,
    [adminId],
  );
  return rowCount ?? 0;
}
