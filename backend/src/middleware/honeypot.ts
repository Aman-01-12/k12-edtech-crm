import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ValidationError } from '../errors/app-error.js';

/**
 * Rejects submissions that filled a field no human can reach.
 *
 * The field is rendered off-screen and hidden from assistive technology, so a
 * value in it is evidence of automation. This is the abuse control that does
 * not depend on the caller's address; see docs/adr/0005.
 */
export function honeypot(fieldName: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const value: unknown = (req.body as Record<string, unknown> | undefined)?.[fieldName];
    const filled = typeof value === 'string' ? value.trim().length > 0 : value != null;

    if (filled) {
      req.log.info({ field: fieldName }, 'Submission rejected by honeypot');
      next(new ValidationError({ _: ['This submission could not be accepted.'] }));
      return;
    }

    next();
  };
}
