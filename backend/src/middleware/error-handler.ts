import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiError } from '@k12/contracts';
import type { AppError } from '../errors/app-error.js';
import {
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  isAppError,
} from '../errors/app-error.js';

/**
 * The only code that writes an error response.
 *
 * Centralising this is what makes the error contract a guarantee rather than a
 * convention: no route can invent its own shape, omit the request id, or leak a
 * stack trace, because no route writes an error at all.
 */

/** Express and body-parser failures, mapped into the taxonomy. */
function normalize(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  // body-parser signals a body over the configured cap and malformed JSON
  // through `type` on its error object. Both are the caller's fault, so they
  // must not be reported as internal failures.
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const { type } = error as { type?: unknown };
    if (type === 'entity.too.large') {
      return new PayloadTooLargeError();
    }
    if (type === 'entity.parse.failed') {
      return new ValidationError({ _: ['The request body is not valid JSON.'] });
    }
  }

  return new InternalError(error);
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Headers already sent means a streamed response failed partway, such as the
  // CSV export. There is no way to turn that into a JSON error, so the only
  // correct action is to log it and let Express destroy the connection; writing
  // would throw and mask the cause.
  if (res.headersSent) {
    req.log.error({ err: error }, 'Request failed after the response had begun');
    next(error);
    return;
  }

  const appError = normalize(error);

  // An unexpected failure is logged at error with its full cause; an expected
  // one is ordinary traffic and would otherwise bury real failures in noise.
  if (appError instanceof InternalError) {
    req.log.error(
      { err: appError.cause ?? error, method: req.method, path: req.path },
      'Unhandled error',
    );
  } else {
    req.log.info(
      { code: appError.code, status: appError.status, method: req.method, path: req.path },
      'Request rejected',
    );
  }

  if (appError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  const body: ApiError = {
    error: appError.message,
    code: appError.code,
    requestId: req.requestId,
    ...(appError.details === undefined ? {} : { details: appError.details }),
  };

  res.status(appError.status).json(body);
};

/**
 * Terminal handler for an unmatched route.
 *
 * Registered after every route so an unknown path produces the standard error
 * shape rather than Express's default HTML, which would leak the stack in
 * development and be unparseable by the client in both environments.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('endpoint'));
};
