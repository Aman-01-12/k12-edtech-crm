import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

/**
 * Admin account persistence.
 *
 * Every statement names the columns it reads or writes. `password_hash` appears
 * in exactly two of them, the credential lookup and the password update, and in
 * no projection that any route can return. That is what makes it impossible for
 * a hash to reach a response by accident rather than merely unlikely.
 */

/** An admin as the dashboard and the session endpoint see them. */
export interface AdminRecord extends Record<string, unknown> {
  id: string;
  email: string;
  full_name: string;
  last_login_at: Date | null;
  created_at: Date;
}

/** An admin plus the hash, used only on the sign-in and password-change paths. */
export interface AdminCredentialRecord extends Record<string, unknown> {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
}

/**
 * Finds a live admin by email address for authentication.
 *
 * Matches on `lower(email)`, which is the expression the unique index is built
 * on, so the lookup uses the index and a difference in capitalisation cannot
 * cause a false mismatch. `deleted_at is null` is part of the predicate rather
 * than a later check, so a deactivated account simply does not exist here.
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

/**
 * Confirms an admin is still live, by id.
 *
 * Called on every authenticated request. That is what makes deactivation take
 * effect immediately rather than whenever the access token happens to expire:
 * the token may still verify, but the account behind it no longer resolves.
 */
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

/** Records a successful sign-in. */
export async function markSignedIn(adminId: string): Promise<void> {
  await pool.query(`update admins set last_login_at = now() where id = $1`, [adminId]);
}

/** Lists live admin accounts, newest first. Never selects the hash. */
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
 * Creates an admin account.
 *
 * @returns the created admin, or `undefined` when the email already belongs to
 *   a live account. Reported through the return type rather than an exception
 *   because a duplicate address is an expected outcome of a form submission,
 *   and the caller turns it into a 409.
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

/**
 * Soft-deletes an admin.
 *
 * @returns whether a live account was deactivated, so the caller can return 404
 *   rather than reporting success for an id that was never there.
 */
export async function softDeleteAdmin(id: string, client: Queryable = pool): Promise<boolean> {
  const { rowCount } = await client.query(
    `update admins set deleted_at = now() where id = $1 and deleted_at is null`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/** Replaces an admin's password hash. */
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

/**
 * Finds a live admin's credential by id, for verifying a current password.
 *
 * Separate from `findLiveAdminById` so the hash is only ever selected by a
 * caller that genuinely needs to compare against it.
 */
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
