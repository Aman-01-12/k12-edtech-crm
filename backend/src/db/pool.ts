import { rootCertificates } from 'node:tls';
import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * `count(*)` is a bigint, which pg returns as a string to avoid precision loss.
 * Every count here is well within safe-integer range, so parsing it stops
 * `"12" + 1` becoming `"121"`. Nothing else is re-typed.
 */
const POSTGRES_BIGINT_OID = 20;
pg.types.setTypeParser(POSTGRES_BIGINT_OID, (value) => Number.parseInt(value, 10));

/**
 * Resolves TLS settings. Secure by default: an encrypted connection to an
 * unverified server still lets an interceptor read every credential that
 * crosses it. See docs/adr/0011-database-tls-verification.md.
 */
function resolveSslConfig(): pg.PoolConfig['ssl'] {
  let host = '';
  try {
    host = new URL(config.DATABASE_URL).hostname;
  } catch {
    // Treat an unparseable URL as remote so TLS is not skipped; the driver
    // reports the malformed URL with a clearer message than we could.
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return false;
  }

  // Added to the public roots rather than replacing them, because Node's `ca`
  // option is a replacement: supplying a private CA alone would reject a
  // provider that happens to use a publicly trusted certificate.
  if (config.DATABASE_CA_CERT !== undefined) {
    return { ca: [config.DATABASE_CA_CERT, ...rootCertificates], rejectUnauthorized: true };
  }

  if (config.DATABASE_SSL_NO_VERIFY) {
    logger.warn(
      { host },
      'Database TLS verification is DISABLED by DATABASE_SSL_NO_VERIFY. The connection is encrypted but the server identity is unverified. Set DATABASE_CA_CERT instead.',
    );
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}

/**
 * Module-level so it is reused across serverless invocations. `max` is small
 * because the provider's transaction pooler already multiplexes many warm
 * instances onto far fewer real backends.
 */
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  // Fail fast rather than queueing behind an exhausted pool.
  connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: 30_000,
  // Enforced by Postgres, so it still applies if the client goes away.
  statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
  ssl: resolveSslConfig(),
});

// Without this listener Node treats an idle-client error as unhandled and
// terminates the process.
pool.on('error', (error) => {
  logger.error({ err: error }, 'Idle database client errored');
});

export async function checkDatabaseReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
