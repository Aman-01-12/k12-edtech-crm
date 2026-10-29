import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

/**
 * Refresh-token persistence.
 *
 * The lookup here deliberately returns revoked rows, which is the opposite of
 * what most "find the active token" queries do. Rotation has to see a revoked
 * token to recognise it as a replay, and a query that filtered them out would
 * report the replay as a token that simply does not exist, destroying the theft
 * signal.
 */

export interface RefreshTokenRecord extends Record<string, unknown> {
  id: string;
  admin_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Finds a refresh token by digest, **including revoked rows**.
 *
 * See the note above: the revoked case is the one that matters most.
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

/** Issues a refresh token row. `predecessorId` links it into its rotation chain. */
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
    // An insert with `returning` that yields no row means the statement did not
    // do what it claimed, which must not be treated as success.
    throw new Error('Refresh token insert returned no row');
  }
  return id;
}

/**
 * Revokes one token.
 *
 * Guarded on `revoked_at is null` so the operation is idempotent and a double
 * rotation cannot overwrite the original revocation timestamp.
 */
export async function revokeToken(id: string, client: Queryable = pool): Promise<boolean> {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Revokes every token in a family.
 *
 * The theft response: presenting an already-rotated token means a token was
 * captured, so every descendant of that sign-in is destroyed rather than just
 * the one presented.
 */
export async function revokeFamily(familyId: string, client: Queryable = pool): Promise<number> {
  const { rowCount } = await client.query(
    `update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`,
    [familyId],
  );
  return rowCount ?? 0;
}

/** Revokes every active token for an admin. Used by sign-out-everywhere paths. */
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
