import { Router } from 'express';
import { checkDatabaseReachable } from '../../db/pool.js';

/**
 * Liveness and readiness.
 *
 * The database check is what makes this useful: a process that is running but
 * cannot reach its database is not ready to serve, and reporting 200 for it
 * would hide the only failure a health check exists to catch.
 *
 * Deliberately exposes no version, hostname, or dependency detail, since the
 * endpoint is unauthenticated and that information helps an attacker fingerprint
 * the deployment.
 */
export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const databaseReachable = await checkDatabaseReachable();

  res.status(databaseReachable ? 200 : 503).json({
    status: databaseReachable ? 'ok' : 'degraded',
    database: databaseReachable ? 'reachable' : 'unreachable',
  });
});
