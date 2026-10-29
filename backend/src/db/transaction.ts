import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * Satisfied by both the pool and a single transaction client, so a repository
 * function works inside a transaction and outside one.
 */
export interface Queryable {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

/**
 * Runs `work` in a transaction, committing on success and rolling back on throw.
 *
 * @param work - every query it issues must use the client it receives, or that
 *   query runs outside the transaction and will not roll back.
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
    try {
      await client.query('rollback');
    } catch {
      // The connection is unusable and about to be discarded by release();
      // reporting this would mask the original failure.
    }
    throw error;
  } finally {
    // In finally so a failure during rollback still returns the connection.
    client.release();
  }
}
