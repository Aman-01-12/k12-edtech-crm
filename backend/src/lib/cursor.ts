import { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * Keyset page cursor encoding the sort position of the last row on a page.
 *
 * Not signed: it conveys no authority, since every page it can address is
 * already visible to the authenticated admin. It is strictly validated instead,
 * so a malformed cursor is a 400 rather than a confusing query.
 */

const cursorPayloadSchema = z.strictObject({
  /** `created_at` of the last row, as an ISO timestamp. */
  c: z.iso.datetime({ offset: true }),
  /** `id` of the last row, breaking ties on identical timestamps. */
  i: z.uuid(),
});

export interface KeysetPosition {
  createdAt: string;
  id: string;
}

export function encodeCursor(position: KeysetPosition): string {
  const payload = { c: position.createdAt, i: position.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** @throws ValidationError when the cursor is not a cursor this server issued. */
export function decodeCursor(cursor: string): KeysetPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError({ cursor: ['The page cursor is malformed.'] });
  }

  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError({ cursor: ['The page cursor is malformed.'] });
  }

  return { createdAt: result.data.c, id: result.data.i };
}
