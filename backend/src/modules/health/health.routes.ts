import { Router } from 'express';
import { checkDatabaseReachable } from '../../db/pool.js';

export const healthRouter = Router();

/**
 * Reports 503 when the database is unreachable: a process that is running but
 * cannot serve is exactly what a health check exists to catch.
 *
 * Exposes no version or dependency detail, since the endpoint is public.
 */
healthRouter.get('/', async (_req, res) => {
  const databaseReachable = await checkDatabaseReachable();

  res.status(databaseReachable ? 200 : 503).json({
    status: databaseReachable ? 'ok' : 'degraded',
    database: databaseReachable ? 'reachable' : 'unreachable',
  });
});
