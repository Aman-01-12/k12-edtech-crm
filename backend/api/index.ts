import app from '../src/app.js';

/**
 * Vercel's serverless Node runtime expects a request handler at `api/*`.
 * An Express app already has the `(req, res)` signature it wants, so this
 * file only has to re-export the one built in `src/app.ts`.
 */
export default app;
