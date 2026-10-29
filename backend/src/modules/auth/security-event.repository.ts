import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

/**
 * Security event log.
 *
 * Append-only, enforced by triggers in `schema.sql` rather than by this module
 * declining to write an update. Nothing here can rewrite history even if a
 * future caller tries.
 *
 * `detail` carries context, and deliberately never carries an inquiry's
 * personal data: a row is referenced by id. Logging a submitter's name or phone
 * number into an audit trail would spread personal data into a table with a
 * different retention story from the one it was collected under.
 */

export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'session_compromised'
  | 'rate_limit_exceeded'
  | 'inquiry_status_changed'
  | 'inquiry_exported'
  | 'password_changed'
  | 'admin_account_changed';

export interface SecurityEventInput {
  eventType: SecurityEventType;
  adminId?: string | undefined;
  /** The address someone tried to sign in with, recorded when no admin matched. */
  emailAttempted?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  detail?: Record<string, unknown> | undefined;
  requestId?: string | undefined;
}

/**
 * Records a security event.
 *
 * Never throws. An audit write failing must not turn a successful sign-in into
 * a 500, because the user's credential was valid and refusing them would be a
 * worse outcome than a gap in the log. The failure is surfaced through the
 * caller's logger instead, which is where an operator is already looking.
 *
 * @param onFailure - invoked with the error when the write fails, so the caller
 *   can log it against the request id it already holds.
 */
export async function recordSecurityEvent(
  event: SecurityEventInput,
  onFailure?: (error: unknown) => void,
  client: Queryable = pool,
): Promise<void> {
  try {
    await client.query(
      `insert into security_events
         (event_type, admin_id, email_attempted, ip_address, user_agent, detail, request_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        event.eventType,
        event.adminId ?? null,
        event.emailAttempted ?? null,
        event.ipAddress ?? null,
        event.userAgent ?? null,
        JSON.stringify(event.detail ?? {}),
        event.requestId ?? null,
      ],
    );
  } catch (error) {
    onFailure?.(error);
  }
}

/**
 * Counts recent events of a type for an admin.
 *
 * Exists for the dashboard's own visibility rather than for enforcement; no
 * access decision reads it.
 */
export async function countRecentEvents(
  eventType: SecurityEventType,
  sinceIso: string,
): Promise<number> {
  const { rows } = await pool.query<{ total: number }>(
    `select count(*) as total from security_events where event_type = $1 and created_at >= $2`,
    [eventType, sinceIso],
  );
  return rows[0]?.total ?? 0;
}
