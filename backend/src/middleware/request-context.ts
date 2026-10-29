import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger, type Logger } from '../lib/logger.js';

/**
 * Per-request correlation.
 *
 * Every error response carries a request id, and the same id tags every log
 * line for that request. That pairing is what turns "something went wrong" into
 * a traceable report: the user quotes the id, and the log explains the cause
 * that was deliberately withheld from them.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlates this request's response with its log lines. */
    requestId: string;
    /** Logger pre-bound to `requestId`. */
    log: Logger;
  }
}

/** Accepts a UUID the caller supplied, so a trace can span a proxy hop. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUEST_ID_HEADER = 'x-request-id';

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.get(REQUEST_ID_HEADER);

  // Only a well-formed UUID is honoured. Echoing an arbitrary client string
  // would let a caller inject content into log lines and into other users'
  // error responses.
  const requestId = supplied !== undefined && UUID_PATTERN.test(supplied) ? supplied : randomUUID();

  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
