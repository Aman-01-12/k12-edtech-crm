import type {
  CreateInquiry,
  Inquiry,
  InquiryNote,
  InquiryStatus,
  InquiryTimelineEntry,
  ListInquiriesQuery,
} from '@k12/contracts';
import { INQUIRY_STATUS_LABELS, toPhoneSearchFragment } from '@k12/contracts';
import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';
import { LIKE_ESCAPE_CHARACTER, toContainsPattern } from '../../lib/like-escape.js';
import { decodeCursor, encodeCursor, type KeysetPosition } from '../../lib/cursor.js';

/**
 * Columns the API returns, named so a new column cannot widen a response.
 *
 * Qualified with `i.` because every read now joins `admins` to resolve the
 * owner's name, and an unqualified `id` would be ambiguous.
 */
const INQUIRY_COLUMNS = `
  i.id, i.user_type, i.category, i.status, i.full_name, i.email, i.phone, i.message,
  i.created_at, i.status_updated_at, i.assigned_to_admin_id,
  owner.full_name as assigned_to_name
`;

/** The owner join, written once so the three read paths cannot diverge. */
const INQUIRY_FROM = `
  from inquiries i
  left join admins owner on owner.id = i.assigned_to_admin_id
`;

/**
 * The same columns, unqualified, for statements that have no FROM clause and
 * therefore no alias to qualify against: `INSERT ... RETURNING` and
 * `UPDATE ... RETURNING`.
 *
 * `assigned_to_name` is a literal null here because the owner's name lives in
 * `admins` and cannot be reached without the join. Callers that need it re-read
 * the row through `findInquiryById`.
 */
const INQUIRY_COLUMNS_UNQUALIFIED = `
  id, user_type, category, status, full_name, email, phone, message,
  created_at, status_updated_at, assigned_to_admin_id,
  null::text as assigned_to_name
`;

interface InquiryRow extends Record<string, unknown> {
  id: string;
  user_type: string;
  category: string;
  status: string;
  full_name: string;
  email: string;
  phone: string;
  message: string;
  created_at: Date;
  status_updated_at: Date | null;
  assigned_to_admin_id: string | null;
  assigned_to_name: string | null;
}

function toInquiry(row: InquiryRow): Inquiry {
  return {
    id: row.id,
    userType: row.user_type as Inquiry['userType'],
    category: row.category as Inquiry['category'],
    status: row.status as Inquiry['status'],
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    statusUpdatedAt: row.status_updated_at?.toISOString() ?? null,
    assignedToAdminId: row.assigned_to_admin_id,
    assignedToName: row.assigned_to_name,
  };
}

/**
 * Builds the optional filter predicates shared by the list, summary and export.
 *
 * One builder for all three is what keeps the summary's counts describing the
 * same rows the table shows. Values are always bound parameters; no fragment
 * interpolates request data.
 */
/** The filterable subset, shared by the list, summary and export. */
export type InquiryFilterQuery = Pick<
  ListInquiriesQuery,
  'category' | 'userType' | 'status' | 'assignedTo' | 'search'
>;

function buildFilters(query: InquiryFilterQuery, params: unknown[]): string {
  const clauses: string[] = [];

  if (query.category !== undefined) {
    params.push(query.category);
    clauses.push(`i.category = $${params.length}`);
  }

  if (query.userType !== undefined) {
    params.push(query.userType);
    clauses.push(`i.user_type = $${params.length}`);
  }

  if (query.status !== undefined) {
    params.push(query.status);
    clauses.push(`i.status = $${params.length}`);
  }

  if (query.assignedTo !== undefined) {
    if (query.assignedTo === 'unassigned') {
      clauses.push(`i.assigned_to_admin_id is null`);
    } else {
      params.push(query.assignedTo);
      clauses.push(`i.assigned_to_admin_id = $${params.length}`);
    }
  }

  if (query.search !== undefined) {
    // One input serves both: a name match always, plus a phone match when the
    // term contains digits. The phone fragment is reduced to digits so
    // `+91 98765 43210` and `9876543210` reach the same row.
    params.push(toContainsPattern(query.search));
    const namePattern = `$${params.length}`;

    const phoneFragment = toPhoneSearchFragment(query.search);
    if (phoneFragment === undefined) {
      clauses.push(`i.full_name ILIKE ${namePattern} ESCAPE '${LIKE_ESCAPE_CHARACTER}'`);
    } else {
      params.push(toContainsPattern(phoneFragment));
      clauses.push(
        `(i.full_name ILIKE ${namePattern} ESCAPE '${LIKE_ESCAPE_CHARACTER}'` +
          ` OR i.phone LIKE $${params.length} ESCAPE '${LIKE_ESCAPE_CHARACTER}')`,
      );
    }
  }

  return clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`;
}

export interface InquiryPage {
  items: Inquiry[];
  nextCursor: string | null;
}

/**
 * Lists inquiries newest first, by keyset rather than offset.
 *
 * `id` is in the sort key so two rows sharing a timestamp cannot cause a row to
 * be skipped or repeated across pages. One extra row is fetched to detect
 * whether a further page exists, which avoids a second count query.
 */
export async function listInquiries(query: ListInquiriesQuery): Promise<InquiryPage> {
  const params: unknown[] = [];
  const filters = buildFilters(query, params);

  let keyset = '';
  if (query.cursor !== undefined) {
    const position: KeysetPosition = decodeCursor(query.cursor);
    params.push(position.createdAt, position.id);
    // Row-wise comparison, which the (created_at DESC, id DESC) index serves.
    keyset = ` AND (i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }

  params.push(query.limit + 1);

  const { rows } = await pool.query<InquiryRow>(
    `select ${INQUIRY_COLUMNS}
       ${INQUIRY_FROM}
      where true${filters}${keyset}
      order by i.created_at desc, i.id desc
      limit $${params.length}`,
    params,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map(toInquiry),
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
        : null,
  };
}

export interface InquirySummary {
  total: number;
  byStatus: Record<InquiryStatus, number>;
}

/** One scan with conditional aggregation, not one query per status. */
export async function summariseInquiries(query: InquiryFilterQuery): Promise<InquirySummary> {
  const params: unknown[] = [];
  const filters = buildFilters(query, params);

  const { rows } = await pool.query<{
    total: number;
    new_count: number;
    in_progress_count: number;
    resolved_count: number;
    closed_count: number;
  }>(
    `select count(*) as total,
            count(*) filter (where i.status = 'new')         as new_count,
            count(*) filter (where i.status = 'in_progress') as in_progress_count,
            count(*) filter (where i.status = 'resolved')    as resolved_count,
            count(*) filter (where i.status = 'closed')      as closed_count
       ${INQUIRY_FROM}
      where true${filters}`,
    params,
  );

  const row = rows[0] ?? {
    total: 0,
    new_count: 0,
    in_progress_count: 0,
    resolved_count: 0,
    closed_count: 0,
  };

  return {
    total: row.total,
    byStatus: {
      new: row.new_count,
      in_progress: row.in_progress_count,
      resolved: row.resolved_count,
      closed: row.closed_count,
    },
  };
}

/** Rows for the export, capped and ordered like the list. */
export async function listInquiriesForExport(
  query: InquiryFilterQuery,
  rowLimit: number,
): Promise<{ items: Inquiry[]; truncated: boolean }> {
  const params: unknown[] = [];
  const filters = buildFilters(query, params);
  params.push(rowLimit + 1);

  const { rows } = await pool.query<InquiryRow>(
    `select ${INQUIRY_COLUMNS}
       ${INQUIRY_FROM}
      where true${filters}
      order by i.created_at desc, i.id desc
      limit $${params.length}`,
    params,
  );

  const truncated = rows.length > rowLimit;
  return {
    items: (truncated ? rows.slice(0, rowLimit) : rows).map(toInquiry),
    truncated,
  };
}

/**
 * Inserts an inquiry, or returns the existing row when the idempotency key was
 * already used.
 *
 * `on conflict do nothing` plus a follow-up read is what makes a retry return
 * the original row instead of raising. The partial unique index is the actual
 * exactly-once guarantee.
 */
export async function createInquiry(
  input: CreateInquiry,
  idempotencyKey: string | undefined,
  client: Queryable = pool,
): Promise<{ inquiry: Inquiry; created: boolean }> {
  const { rows } = await client.query<InquiryRow>(
    `insert into inquiries (user_type, category, full_name, email, phone, message, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (idempotency_key) where idempotency_key is not null do nothing
     returning ${INQUIRY_COLUMNS_UNQUALIFIED}`,
    [
      input.userType,
      input.category,
      input.fullName,
      input.email,
      input.phone,
      input.message,
      idempotencyKey ?? null,
    ],
  );

  const inserted = rows[0];
  if (inserted !== undefined) {
    return { inquiry: toInquiry(inserted), created: true };
  }

  if (idempotencyKey === undefined) {
    throw new Error('Inquiry insert returned no row');
  }

  const existing = await client.query<InquiryRow>(
    `select ${INQUIRY_COLUMNS} ${INQUIRY_FROM} where i.idempotency_key = $1 limit 1`,
    [idempotencyKey],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw new Error('Idempotent insert conflicted but the original row was not found');
  }
  return { inquiry: toInquiry(row), created: false };
}

/**
 * Updates only the status and its trail.
 *
 * @returns the updated inquiry, or undefined when no such row exists, so the
 *   caller returns 404 rather than reporting success.
 */
export async function updateInquiryStatus(
  id: string,
  status: InquiryStatus,
  adminId: string,
  client: Queryable = pool,
): Promise<{ inquiry: Inquiry; previousStatus: InquiryStatus } | undefined> {
  // The CTE snapshots the status before the UPDATE runs, so the timeline can
  // record what it moved *from* without a second round trip.
  const { rows } = await client.query<InquiryRow & { previous_status: string }>(
    `with before as (select status from inquiries where id = $1)
     update inquiries
        set status = $2, status_updated_at = now(), status_updated_by = $3
      where id = $1
      returning ${INQUIRY_COLUMNS_UNQUALIFIED},
                (select status from before) as previous_status`,
    [id, status, adminId],
  );
  const row = rows[0];
  if (row === undefined) {
    return undefined;
  }
  // The RETURNING clause cannot reach the owner join, so the name is read back
  // through the normal path rather than left wrongly null in the response.
  const full = await findInquiryById(id, client);
  return {
    inquiry: full ?? toInquiry(row),
    previousStatus: row.previous_status as InquiryStatus,
  };
}

/** @returns the inquiry, or undefined so the caller answers 404. */
export async function findInquiryById(
  id: string,
  client: Queryable = pool,
): Promise<Inquiry | undefined> {
  const { rows } = await client.query<InquiryRow>(
    `select ${INQUIRY_COLUMNS} ${INQUIRY_FROM} where i.id = $1 limit 1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? undefined : toInquiry(row);
}

/**
 * Sets or clears the owner.
 *
 * @param assignedToAdminId - null unassigns, which is a deliberate action
 *   rather than a missing value.
 * @returns the updated inquiry, or undefined when no such row exists.
 */
export async function assignInquiry(
  id: string,
  assignedToAdminId: string | null,
  client: Queryable = pool,
): Promise<Inquiry | undefined> {
  const { rowCount } = await client.query(
    `update inquiries set assigned_to_admin_id = $2 where id = $1`,
    [id, assignedToAdminId],
  );
  if ((rowCount ?? 0) === 0) {
    return undefined;
  }
  return findInquiryById(id, client);
}

interface NoteRow extends Record<string, unknown> {
  id: string;
  body: string;
  author_name: string;
  admin_id: string | null;
  created_at: Date;
}

/**
 * @param viewerAdminId - used only to mark which notes the caller may delete.
 *   The authorization itself is enforced by `deleteInquiryNote`, not by this
 *   flag, which is presentation.
 */
function toNote(row: NoteRow, viewerAdminId: string): InquiryNote {
  return {
    id: row.id,
    body: row.body,
    authorName: row.author_name,
    authorAdminId: row.admin_id,
    createdAt: row.created_at.toISOString(),
    deletableByViewer: row.admin_id === viewerAdminId,
  };
}

export async function listInquiryNotes(
  inquiryId: string,
  viewerAdminId: string,
  client: Queryable = pool,
): Promise<InquiryNote[]> {
  const { rows } = await client.query<NoteRow>(
    `select id, body, author_name, admin_id, created_at
       from inquiry_notes
      where inquiry_id = $1
      order by created_at desc, id desc`,
    [inquiryId],
  );
  return rows.map((row) => toNote(row, viewerAdminId));
}

export async function insertInquiryNote(
  input: { inquiryId: string; adminId: string; authorName: string; body: string },
  client: Queryable = pool,
): Promise<InquiryNote> {
  const { rows } = await client.query<NoteRow>(
    `insert into inquiry_notes (inquiry_id, admin_id, author_name, body)
     values ($1, $2, $3, $4)
     returning id, body, author_name, admin_id, created_at`,
    [input.inquiryId, input.adminId, input.authorName, input.body],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Note insert returned no row');
  }
  return toNote(row, input.adminId);
}

/**
 * Deletes a note, but only the caller's own.
 *
 * The `admin_id` predicate is the authorization: it is enforced in the
 * statement rather than by reading the note first and comparing in
 * application code, so there is no window between the check and the write.
 *
 * @returns whether a row was deleted. False covers both "no such note" and
 *   "not yours", which the caller reports identically so the response cannot
 *   confirm that someone else's note exists.
 */
export async function deleteInquiryNote(
  input: { noteId: string; inquiryId: string; adminId: string },
  client: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `delete from inquiry_notes where id = $1 and inquiry_id = $2 and admin_id = $3`,
    [input.noteId, input.inquiryId, input.adminId],
  );
  return (rowCount ?? 0) > 0;
}

interface TimelineRow extends Record<string, unknown> {
  id: string;
  event_type: string;
  detail: Record<string, unknown>;
  created_at: Date;
  actor_name: string | null;
}

const TIMELINE_KIND: Record<string, InquiryTimelineEntry['kind']> = {
  inquiry_status_changed: 'status_changed',
  inquiry_assigned: 'assigned',
  inquiry_note_added: 'note_added',
  inquiry_note_deleted: 'note_deleted',
};

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Turns a logged event into one line of plain English. */
function summarise(row: TimelineRow): string {
  const label = (value: unknown): string => {
    const key = asText(value);
    return key !== undefined && key in INQUIRY_STATUS_LABELS
      ? INQUIRY_STATUS_LABELS[key as InquiryStatus]
      : 'unknown';
  };

  switch (row.event_type) {
    case 'inquiry_status_changed': {
      const from = asText(row.detail.previousStatus);
      return from === undefined
        ? `Status set to ${label(row.detail.status)}`
        : `Status moved from ${label(from)} to ${label(row.detail.status)}`;
    }
    case 'inquiry_assigned': {
      const to = asText(row.detail.assignedToName);
      return to === undefined ? 'Unassigned' : `Assigned to ${to}`;
    }
    case 'inquiry_note_added':
      return 'Added a note';
    case 'inquiry_note_deleted':
      return 'Deleted a note';
    default:
      return 'Updated';
  }
}

/**
 * The enquiry's history, read from the append-only security log.
 *
 * No second history table: status changes and assignments are already audited
 * there, and duplicating them would create two records that could disagree.
 */
export async function listInquiryTimeline(
  inquiryId: string,
  client: Queryable = pool,
): Promise<InquiryTimelineEntry[]> {
  const { rows } = await client.query<TimelineRow>(
    `select e.id, e.event_type, e.detail, e.created_at, actor.full_name as actor_name
       from security_events e
       left join admins actor on actor.id = e.admin_id
      where e.detail ->> 'inquiryId' = $1
        and e.event_type in ('inquiry_status_changed', 'inquiry_assigned',
                             'inquiry_note_added', 'inquiry_note_deleted')
      order by e.created_at desc
      limit 100`,
    [inquiryId],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: TIMELINE_KIND[row.event_type] ?? 'status_changed',
    actorName: row.actor_name,
    createdAt: row.created_at.toISOString(),
    summary: summarise(row),
  }));
}
