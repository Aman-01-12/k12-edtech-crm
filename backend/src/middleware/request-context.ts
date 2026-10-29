import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger, type Logger } from '../lib/logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlates this request's response with its log lines. */
    requestId: string;
    /** Logger pre-bound to `requestId`. */
    log: Logger;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Pairs every error response with its log lines, which is what turns "something
 * went wrong" into a traceable report.
 *
 * A caller-supplied id is honoured only if it is a well-formed UUID; echoing an
 * arbitrary string would let a caller inject content into log lines.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.get(REQUEST_ID_HEADER);
  const requestId = supplied !== undefined && UUID_PATTERN.test(supplied) ? supplied : randomUUID();

  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
