import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';

/**
 * Append-only, enforced by triggers in schema.sql rather than by this module
 * declining to write an update.
 *
 * `detail` never carries an inquiry's personal data; a row is referenced by id.
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
  | 'admin_account_changed'
  | 'password_reset_completed'
  | 'inquiry_assigned'
  | 'inquiry_note_added'
  | 'inquiry_note_deleted'
  | 'inquiry_replied';

export interface SecurityEventInput {
  eventType: SecurityEventType;
  adminId?: string | undefined;
  /** The address someone tried, recorded when no admin matched. */
  emailAttempted?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  detail?: Record<string, unknown> | undefined;
  requestId?: string | undefined;
}

/**
 * Never throws. An audit write failing must not turn a valid sign-in into a
 * 500; refusing the user would be worse than a gap in the log.
 *
 * @param onFailure - receives the error so the caller can log it against the
 *   request id it already holds.
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
