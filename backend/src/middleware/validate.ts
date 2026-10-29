import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * Validated values replace the originals, so a handler can only reach parsed
 * and normalized data. The schemas normalize as well as check, so a handler
 * reading the raw body would get an un-canonicalised phone number.
 */

/**
 * Walks issues directly rather than using `flattenError`, which discards path
 * depth. An issue with no path, such as an unrecognized key on a strict object,
 * is reported under `_` so the response still explains the rejection.
 */
function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    const existing = details[field];
    if (existing === undefined) {
      details[field] = [issue.message];
    } else {
      existing.push(issue.message);
    }
  }

  return details;
}

export function validateBody(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Express 5 exposes `req.query` as a getter, so the result is attached separately. */
export function validateQuery(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

export function validateParams(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }
    req.validatedParams = result.data;
    next();
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `validateQuery`; typed at the point of use via a schema's output. */
    validatedQuery?: unknown;
    validatedParams?: unknown;
  }
}
