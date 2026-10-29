import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ValidationError } from '../errors/app-error.js';

/**
 * Honeypot check for the public submission form.
 *
 * The network-keyed rate limit on that endpoint cannot be made trustworthy:
 * carrier NAT puts many unrelated people behind one address, so the limit has
 * to be generous, and a determined abuser rotates addresses anyway. This is the
 * layer that does not depend on the network at all.
 *
 * The form renders a field positioned off-screen and marked `aria-hidden` with
 * `tabIndex={-1}`, so no sighted user, screen-reader user or keyboard user ever
 * reaches it. A bot that fills every input it finds does reach it, and a filled
 * value is therefore strong evidence of automation.
 *
 * Deliberately not a captcha. A captcha costs every legitimate user effort and
 * adds a third-party dependency and a privacy question; a honeypot costs them
 * nothing. It also catches less, which is why it is one layer among several
 * rather than the answer.
 */

/**
 * Rejected rather than silently accepted.
 *
 * Returning a convincing success would be marginally better anti-abuse, since a
 * bot would not learn the field is a trap. It is not done because the API must
 * never report that it stored an inquiry it did not store, and a caller cannot
 * distinguish "your submission was discarded" from "your submission is lost".
 * Honesty about what happened wins over a small gain against unsophisticated
 * bots.
 */
export function honeypot(fieldName: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const value: unknown = (req.body as Record<string, unknown> | undefined)?.[fieldName];

    const looksAutomated = typeof value === 'string' ? value.trim().length > 0 : value != null;

    if (looksAutomated) {
      req.log.info({ field: fieldName }, 'Submission rejected by honeypot');
      next(new ValidationError({ _: ['This submission could not be accepted.'] }));
      return;
    }

    next();
  };
}
