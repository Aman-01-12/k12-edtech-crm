import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * Schema validation at the HTTP boundary.
 *
 * Validated values replace the originals on the request, so a handler can only
 * reach the parsed and normalized data. That matters because the schemas
 * normalize as well as check: a handler reading `req.body` directly would get
 * the raw phone number rather than its canonical form.
 */

/**
 * Groups a Zod error's messages by the field they belong to.
 *
 * Walks the issues directly rather than using `flattenError`, because flatten
 * discards the path depth for nested fields and collapses whole-object errors
 * into a separate bucket. An issue with no path, such as an unrecognized key on
 * a strict object, is reported under `_` so the response still explains the
 * rejection instead of arriving empty.
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

/** Validates and replaces `req.body`. */
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

/**
 * Validates `req.query`.
 *
 * Express 5 exposes `req.query` as a getter, so the parsed result is attached
 * as `req.validatedQuery` rather than assigned back over it.
 */
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

/** Validates `req.params`, so a malformed id never reaches a query. */
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
    /** Set by `validateQuery`. Typed at the point of use via a schema's output type. */
    validatedQuery?: unknown;
    /** Set by `validateParams`. */
    validatedParams?: unknown;
  }
}
