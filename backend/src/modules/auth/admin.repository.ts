import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

/**
 * Every statement names its columns. `password_hash` appears only in the two
 * credential lookups and the password update, never in a projection a route can
 * return, which is what makes a leaked hash impossible rather than unlikely.
 */

export interface AdminRecord extends Record<string, unknown> {
  id: string;
  email: string;
  full_name: string;
  last_login_at: Date | null;
  created_at: Date;
}

export interface AdminCredentialRecord extends Record<string, unknown> {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
}

/**
 * Matches on `lower(email)`, the expression the unique index is built on, so the
 * lookup uses the index and capitalisation cannot cause a false mismatch.
 */
export async function findLiveAdminCredentialByEmail(
  email: string,
): Promise<AdminCredentialRecord | undefined> {
  const { rows } = await pool.query<AdminCredentialRecord>(
    `select id, email, full_name, password_hash
       from admins
      where lower(email) = lower($1)
        and deleted_at is null
      limit 1`,
    [email],
  );
  return rows[0];
}

/** Called on every authenticated request; see `requireAdmin`. */
export async function findLiveAdminById(id: string): Promise<AdminRecord | undefined> {
  const { rows } = await pool.query<AdminRecord>(
    `select id, email, full_name, last_login_at, created_at
       from admins
      where id = $1
        and deleted_at is null
      limit 1`,
    [id],
  );
  return rows[0];
}

export async function markSignedIn(adminId: string): Promise<void> {
  await pool.query(`update admins set last_login_at = now() where id = $1`, [adminId]);
}

export async function listLiveAdmins(): Promise<AdminRecord[]> {
  const { rows } = await pool.query<AdminRecord>(
    `select id, email, full_name, last_login_at, created_at
       from admins
      where deleted_at is null
      order by created_at desc, id desc`,
  );
  return rows;
}

/**
 * @returns the created admin, or undefined when the address already belongs to
 *   a live account. A duplicate is an expected form outcome, so it is reported
 *   through the return type and the caller turns it into a 409.
 */
export async function insertAdmin(
  input: { email: string; passwordHash: string; fullName: string },
  client: Queryable = pool,
): Promise<AdminRecord | undefined> {
  const { rows } = await client.query<AdminRecord>(
    `insert into admins (email, password_hash, full_name)
     select $1, $2, $3
      where not exists (
        select 1 from admins where lower(email) = lower($1) and deleted_at is null
      )
     returning id, email, full_name, last_login_at, created_at`,
    [input.email, input.passwordHash, input.fullName],
  );
  return rows[0];
}

/** @returns whether a live account was deactivated, so the caller can 404. */
export async function softDeleteAdmin(id: string, client: Queryable = pool): Promise<boolean> {
  const { rowCount } = await client.query(
    `update admins set deleted_at = now() where id = $1 and deleted_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function updatePasswordHash(
  adminId: string,
  passwordHash: string,
  client: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `update admins set password_hash = $2 where id = $1 and deleted_at is null`,
    [adminId, passwordHash],
  );
  return (rowCount ?? 0) > 0;
}

/** Separate from `findLiveAdminById` so the hash is only read when compared against. */
export async function findLiveAdminCredentialById(
  id: string,
): Promise<AdminCredentialRecord | undefined> {
  const { rows } = await pool.query<AdminCredentialRecord>(
    `select id, email, full_name, password_hash
       from admins
      where id = $1
        and deleted_at is null
      limit 1`,
    [id],
  );
  return rows[0];
}
