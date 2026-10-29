import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * A query interface satisfied by both the pool and a single transaction client.
 *
 * Repository functions accept this rather than importing the pool, so the same
 * function works inside a transaction and outside one. That is what lets the
 * refresh rotation revoke a token and insert its replacement atomically while
 * reusing the ordinary repository calls.
 */
export interface Queryable {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

/**
 * Runs `work` inside a single transaction, committing on success and rolling
 * back on any thrown error.
 *
 * The client is released in a `finally` block, so a failure during rollback
 * still returns the connection to the pool. Leaking a connection here would
 * exhaust the pool after a handful of errors, which is a far worse outcome than
 * the original failure.
 *
 * @param work - receives the transaction client; every query it issues must use
 *   that client, or the query runs outside the transaction and will not roll back.
 */
export async function withTransaction<Result>(
  work: (client: Queryable) => Promise<Result>,
): Promise<Result> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    // Rollback is best-effort: if the connection is already broken this throws,
    // and the original error is what the caller needs to see.
    try {
      await client.query('rollback');
    } catch {
      // Intentionally swallowed. The connection is unusable and is about to be
      // discarded by `release`; reporting this would mask the real failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
