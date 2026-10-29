import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

export interface RefreshTokenRecord extends Record<string, unknown> {
  id: string;
  admin_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Returns revoked rows deliberately. Rotation must see a revoked token to
 * recognise a replay; filtering them out would report the replay as a token
 * that never existed and destroy the theft signal.
 */
export async function findByHashIncludingRevoked(
  tokenHash: Buffer,
  client: Queryable = pool,
): Promise<RefreshTokenRecord | undefined> {
  const { rows } = await client.query<RefreshTokenRecord>(
    `select id, admin_id, family_id, expires_at, revoked_at
       from refresh_tokens
      where token_hash = $1
      limit 1`,
    [tokenHash],
  );
  return rows[0];
}

export async function insertRefreshToken(
  input: {
    adminId: string;
    tokenHash: Buffer;
    familyId: string;
    expiresAt: Date;
    predecessorId?: string | undefined;
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
  },
  client: Queryable = pool,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into refresh_tokens
       (admin_id, token_hash, family_id, predecessor_id, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.adminId,
      input.tokenHash,
      input.familyId,
      input.predecessorId ?? null,
      input.userAgent ?? null,
      input.ipAddress ?? null,
      input.expiresAt,
    ],
  );

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('Refresh token insert returned no row');
  }
  return id;
}

/** Guarded on `revoked_at is null` so a double rotation cannot overwrite the timestamp. */
export async function revokeToken(id: string, client: Queryable = pool): Promise<boolean> {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The theft response: a replayed token means one was captured, so every
 * descendant of that sign-in is destroyed, not just the one presented.
 */
export async function revokeFamily(familyId: string, client: Queryable = pool): Promise<number> {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`,
    [familyId],
  );
  return rowCount ?? 0;
}

export async function revokeAllForAdmin(
  adminId: string,
  client: Queryable = pool,
): Promise<number> {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where admin_id = $1 and revoked_at is null`,
    [adminId],
  );
  return rowCount ?? 0;
}
