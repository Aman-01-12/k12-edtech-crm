import app from './app.js';
import { config } from './config/env.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';

/**
 * Local and container entry point.
 *
 * Separate from `app.ts` because the serverless host imports the app and owns
 * the request lifecycle itself; only a long-lived process should bind a port.
 */

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

/**
 * Graceful shutdown.
 *
 * Stops accepting connections, lets in-flight requests finish, then closes the
 * pool. Without the timeout a single hung request would block shutdown
 * indefinitely and the platform would eventually kill the process mid-write.
 */
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forced = setTimeout(() => {
    logger.warn('Shutdown grace period expired; exiting with connections open');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forced.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
  logger.info('Shutdown complete');
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

// A rejection that reached the top level is a bug, not a recoverable state, so
// it is logged with its cause rather than swallowed to keep the process alive.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
