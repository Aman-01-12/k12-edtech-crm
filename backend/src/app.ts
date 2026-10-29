import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { inquiriesRouter } from './modules/inquiries/inquiries.routes.js';

/**
 * Builds the Express application.
 *
 * Exported as a factory so tests can construct an isolated instance, and
 * default-exported as a built app because that is what the serverless host
 * detects. Nothing here opens a port; `server.ts` does that for local runs.
 */

/**
 * An exact-match CORS allowlist.
 *
 * The request's own `Origin` is never reflected. Reflecting it while
 * `credentials: true` is set would let any site read authenticated responses,
 * which defeats the point of having an allowlist at all.
 *
 * A request with no `Origin` is permitted because that is what a same-origin
 * request, a server-to-server call and `curl` all look like, and the browser's
 * own same-origin policy is what protects the first case.
 */
function buildCorsOptions(): CorsOptions {
  const allowed = new Set(config.CORS_ALLOWED_ORIGINS);

  return {
    origin(origin, callback) {
      if (origin === undefined || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      // Reported as "not allowed" rather than thrown, so the browser receives a
      // response without CORS headers instead of a 500.
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-Export-Truncated'],
    maxAge: 600,
  };
}

export function createApp(): Express {
  const app = express();

  // The deployment sits behind a proxy that terminates TLS, so the client IP
  // arrives in `X-Forwarded-For`. Without this, every rate limit would key on
  // the proxy's address and limit all users as one. Trusting exactly one hop
  // rather than the whole chain is what stops a client spoofing the header.
  app.set('trust proxy', 1);

  // Express advertises itself in a response header by default, which tells an
  // attacker what to target.
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      // This API serves only JSON, so the policy is exactly two directives.
      // `useDefaults: false` is deliberate: helmet's default set would
      // otherwise merge in `script-src 'self'` and `style-src 'unsafe-inline'`,
      // which can never apply to a JSON response and leave an `'unsafe-inline'`
      // in the policy that a reader has to stop and reason about.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // One year, which is the minimum for preload eligibility.
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Authenticated API responses must never be cached by a browser or a shared
  // proxy: a cached inquiry list is a data leak on a shared machine.
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(cors(buildCorsOptions()));
  app.use(compression());

  // The public submission endpoint is unauthenticated, so an unbounded body is
  // a trivial memory-exhaustion vector. The cap is enforced before parsing.
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/inquiries', inquiriesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp();
