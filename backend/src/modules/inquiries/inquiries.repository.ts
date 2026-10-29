import type { CreateInquiry, Inquiry, InquiryStatus, ListInquiriesQuery } from '@k12/contracts';
import { toPhoneSearchFragment } from '@k12/contracts';
import { pool } from '../../db/pool.js';
import type { Queryable } from '../../db/transaction.js';
import { LIKE_ESCAPE_CHARACTER, toContainsPattern } from '../../lib/like-escape.js';
import { decodeCursor, encodeCursor, type KeysetPosition } from '../../lib/cursor.js';

/** Columns the API returns, named so a new column cannot widen a response. */
const INQUIRY_COLUMNS = `
  id, user_type, category, status, full_name, email, phone, message,
  created_at, status_updated_at
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
  };
}

/**
 * Builds the optional filter predicates shared by the list, summary and export.
 *
 * One builder for all three is what keeps the summary's counts describing the
 * same rows the table shows. Values are always bound parameters; no fragment
 * interpolates request data.
 */
function buildFilters(
  query: Pick<ListInquiriesQuery, 'category' | 'userType' | 'search'>,
  params: unknown[],
): string {
  const clauses: string[] = [];

  if (query.category !== undefined) {
    params.push(query.category);
    clauses.push(`category = $${params.length}`);
  }

  if (query.userType !== undefined) {
    params.push(query.userType);
    clauses.push(`user_type = $${params.length}`);
  }

  if (query.search !== undefined) {
    // One input serves both: a name match always, plus a phone match when the
    // term contains digits. The phone fragment is reduced to digits so
    // `+91 98765 43210` and `9876543210` reach the same row.
    params.push(toContainsPattern(query.search));
    const namePattern = `$${params.length}`;

    const phoneFragment = toPhoneSearchFragment(query.search);
    if (phoneFragment === undefined) {
      clauses.push(`full_name ILIKE ${namePattern} ESCAPE '${LIKE_ESCAPE_CHARACTER}'`);
    } else {
      params.push(toContainsPattern(phoneFragment));
      clauses.push(
        `(full_name ILIKE ${namePattern} ESCAPE '${LIKE_ESCAPE_CHARACTER}'` +
          ` OR phone LIKE $${params.length} ESCAPE '${LIKE_ESCAPE_CHARACTER}')`,
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
    keyset = ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }

  params.push(query.limit + 1);

  const { rows } = await pool.query<InquiryRow>(
    `select ${INQUIRY_COLUMNS}
       from inquiries
      where true${filters}${keyset}
      order by created_at desc, id desc
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
export async function summariseInquiries(
  query: Pick<ListInquiriesQuery, 'category' | 'userType' | 'search'>,
): Promise<InquirySummary> {
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
            count(*) filter (where status = 'new')         as new_count,
            count(*) filter (where status = 'in_progress') as in_progress_count,
            count(*) filter (where status = 'resolved')    as resolved_count,
            count(*) filter (where status = 'closed')      as closed_count
       from inquiries
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
  query: Pick<ListInquiriesQuery, 'category' | 'userType' | 'search'>,
  rowLimit: number,
): Promise<{ items: Inquiry[]; truncated: boolean }> {
  const params: unknown[] = [];
  const filters = buildFilters(query, params);
  params.push(rowLimit + 1);

  const { rows } = await pool.query<InquiryRow>(
    `select ${INQUIRY_COLUMNS}
       from inquiries
      where true${filters}
      order by created_at desc, id desc
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
     returning ${INQUIRY_COLUMNS}`,
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
    `select ${INQUIRY_COLUMNS} from inquiries where idempotency_key = $1 limit 1`,
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
): Promise<Inquiry | undefined> {
  const { rows } = await client.query<InquiryRow>(
    `update inquiries
        set status = $2, status_updated_at = now(), status_updated_by = $3
      where id = $1
      returning ${INQUIRY_COLUMNS}`,
    [id, status, adminId],
  );
  const row = rows[0];
  return row === undefined ? undefined : toInquiry(row);
}
