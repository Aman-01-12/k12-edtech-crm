import { Router } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  type ChangePassword,
  type LoginCredentials,
  type LoginResponse,
} from '@k12/contracts';
import { TokenInvalidError } from '../../errors/app-error.js';
import { requireCsrfToken } from '../../middleware/csrf.js';
import {
  loginAccountLimiter,
  loginNetworkLimiter,
  refreshLimiter,
} from '../../middleware/rate-limit.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validateBody } from '../../middleware/validate.js';
import {
  clearSessionCookies,
  readCookie,
  setAccessTokenCookie,
  setCsrfTokenCookie,
  setRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE,
} from './cookies.js';
import {
  changePassword,
  rotateRefreshToken,
  signIn,
  signOut,
  type IssuedSession,
  type RequestContext,
} from './auth.service.js';

/**
 * Authentication routes.
 *
 * Each applies only the middleware it needs. Sign-in carries both rate
 * limiters, because an attacker evades a per-account limit by spreading across
 * accounts and evades a per-network limit by spreading across networks.
 */
export const authRouter = Router();

/** Request-scoped context the service records against events. */
function contextFrom(req: Parameters<typeof requireAdmin>[0]): RequestContext {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
    onAuditFailure: (error: unknown) => {
      req.log.error({ err: error }, 'Failed to record security event');
    },
  };
}

/** Writes an issued session to the response as cookies plus a body. */
function respondWithSession(
  res: Parameters<Parameters<typeof authRouter.post>[1]>[1],
  session: IssuedSession,
): void {
  setAccessTokenCookie(res, session.accessToken);
  setRefreshTokenCookie(res, session.refreshToken);
  setCsrfTokenCookie(res, session.csrfToken);

  // No token in the body: both live in cookies the page cannot read. The
  // lifetime is returned so the client can refresh ahead of expiry rather than
  // waiting for a 401.
  const body: LoginResponse = {
    admin: session.admin,
    expiresIn: session.expiresInSeconds,
  };
  res.status(200).json(body);
}

authRouter.post(
  '/login',
  // Limiters run before validation so a malformed body still costs the caller
  // its allowance; otherwise the limit could be bypassed with invalid payloads.
  loginNetworkLimiter,
  loginAccountLimiter,
  validateBody(loginSchema),
  async (req, res) => {
    const session = await signIn(req.body as LoginCredentials, contextFrom(req));
    respondWithSession(res, session);
  },
);

authRouter.post('/refresh', refreshLimiter, async (req, res) => {
  const presented = readCookie(
    req.cookies as Record<string, unknown> | undefined,
    REFRESH_TOKEN_COOKIE,
  );
  if (presented === undefined) {
    throw new TokenInvalidError('You are not signed in.');
  }

  try {
    const session = await rotateRefreshToken(presented, contextFrom(req));
    respondWithSession(res, session);
  } catch (error) {
    // Any rotation failure leaves the browser holding a token that will never
    // work again, so the cookies are cleared rather than left to fail on every
    // subsequent request.
    clearSessionCookies(res);
    throw error;
  }
});

/**
 * Sign-out.
 *
 * Requires authentication and a CSRF token: without the latter, a third-party
 * page could sign a user out, which is a minor but real nuisance.
 */
authRouter.post('/logout', requireAdmin, requireCsrfToken, async (req, res) => {
  const presented = readCookie(
    req.cookies as Record<string, unknown> | undefined,
    REFRESH_TOKEN_COOKIE,
  );

  await signOut(presented, { ...contextFrom(req), adminId: req.admin?.adminId });

  clearSessionCookies(res);
  res.status(204).send();
});

/** The current session, used by the frontend's route guard. */
authRouter.get('/me', requireAdmin, (req, res) => {
  const admin = req.admin;
  if (admin === undefined) {
    throw new TokenInvalidError();
  }

  res.status(200).json({
    admin: { id: admin.adminId, email: admin.email, fullName: admin.fullName },
  });
});

authRouter.post(
  '/change-password',
  requireAdmin,
  requireCsrfToken,
  validateBody(changePasswordSchema),
  async (req, res) => {
    const admin = req.admin;
    if (admin === undefined) {
      throw new TokenInvalidError();
    }

    const { currentPassword, newPassword } = req.body as ChangePassword;
    const session = await changePassword(
      { adminId: admin.adminId, currentPassword, newPassword },
      contextFrom(req),
    );

    respondWithSession(res, session);
  },
);
