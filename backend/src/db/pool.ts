import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * The connection pool.
 *
 * Module-level and therefore reused across invocations when the API runs as a
 * serverless function, which is the difference between one connection per
 * instance and one per request.
 *
 * `max` is deliberately small. The provider's transaction-mode pooler sits in
 * front of Postgres and multiplexes many warm function instances onto far fewer
 * real backends, so a large per-instance pool would exhaust the upstream limit
 * rather than buy throughput.
 */

/**
 * Postgres returns `bigint` and `numeric` as strings because they can exceed
 * what a JavaScript number represents exactly. `count(*)` is a `bigint`, and
 * every count this application takes is comfortably within safe-integer range,
 * so parsing it to a number here is what stops `"12" + 1` becoming `"121"` in a
 * summary. Nothing else is re-typed: silently coercing a type whose range does
 * not fit is how precision is lost.
 */
const POSTGRES_BIGINT_OID = 20;
pg.types.setTypeParser(POSTGRES_BIGINT_OID, (value) => Number.parseInt(value, 10));

/**
 * Resolves the TLS settings for the connection.
 *
 * Secure by default. A local database needs no TLS at all; anything remote is
 * verified, because an encrypted connection to an unverified server still
 * allows an interceptor to read every credential and every inquiry that crosses
 * it. Supabase signs with its own CA, so `DATABASE_CA_CERT` is how verification
 * is made possible rather than merely demanded.
 *
 * See docs/adr/0011-database-tls-verification.md.
 */
function resolveSslConfig(): pg.PoolConfig['ssl'] {
  const host = (() => {
    try {
      return new URL(config.DATABASE_URL).hostname;
    } catch {
      // An unparseable URL is reported by the driver with a clearer message
      // than anything invented here; treat it as remote so TLS is not skipped.
      return '';
    }
  })();

  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal) {
    return false;
  }

  if (config.DATABASE_CA_CERT !== undefined) {
    return { ca: config.DATABASE_CA_CERT, rejectUnauthorized: true };
  }

  if (config.DATABASE_SSL_NO_VERIFY) {
    logger.warn(
      { host },
      'Database TLS certificate verification is DISABLED by DATABASE_SSL_NO_VERIFY. The connection is encrypted but the server identity is unverified, so it can be intercepted. Set DATABASE_CA_CERT instead.',
    );
    return { rejectUnauthorized: false };
  }

  // Verify against Node's default trust store. If the provider's certificate
  // does not chain to a public CA this fails at connect time with a clear
  // error, which is the correct outcome: a loud failure beats a silent
  // downgrade to an unverified connection.
  return { rejectUnauthorized: true };
}

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,

  max: config.DATABASE_POOL_MAX,

  // Fail fast when the pool is exhausted rather than queueing requests behind
  // it, so load sheds as an error the caller can see instead of a hang.
  connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,

  idleTimeoutMillis: 30_000,

  // Server-side cap on any single query, so one pathological statement cannot
  // hold a connection indefinitely. Enforced by Postgres, not by the client,
  // which means it still applies if the client goes away mid-query.
  statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,

  ssl: resolveSslConfig(),
});

/**
 * An idle client erroring is a pool-level event with no request to attach it
 * to. Without this listener Node treats it as an unhandled `error` event and
 * terminates the process.
 */
pool.on('error', (error) => {
  logger.error({ err: error }, 'Idle database client errored');
});

/** Reports whether the database answers, for the health endpoint. */
export async function checkDatabaseReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return false;
  }
}

/** Closes the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
