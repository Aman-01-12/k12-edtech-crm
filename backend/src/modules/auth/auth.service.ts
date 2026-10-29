import { randomUUID } from 'node:crypto';
import type { AuthenticatedAdmin, LoginCredentials } from '@k12/contracts';
import { config } from '../../config/env.js';
import { withTransaction } from '../../db/transaction.js';
import {
  InvalidCredentialsError,
  SessionCompromisedError,
  TokenInvalidError,
} from '../../errors/app-error.js';
import {
  findLiveAdminCredentialByEmail,
  findLiveAdminCredentialById,
  markSignedIn,
  updatePasswordHash,
} from './admin.repository.js';
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from './password.js';
import {
  findByHashIncludingRevoked,
  insertRefreshToken,
  revokeAllForAdmin,
  revokeFamily,
  revokeToken,
} from './refresh-token.repository.js';
import { recordSecurityEvent } from './security-event.repository.js';
import {
  generateCsrfToken,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './tokens.js';

/**
 * Authentication business rules.
 *
 * Deliberately free of HTTP: no `req`, no `res`, no cookies, no status codes.
 * The routes translate between this and HTTP, which is what lets these flows be
 * tested directly and keeps the security logic readable in one place.
 */

/** Context the caller can record against an event or bind to a session. */
export interface RequestContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  onAuditFailure?: ((error: unknown) => void) | undefined;
}

/** Everything a route needs to establish a session in the browser. */
export interface IssuedSession {
  admin: AuthenticatedAdmin;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  /** Access-token lifetime in seconds, derived from the configured TTL. */
  expiresInSeconds: number;
}

function toAuthenticatedAdmin(record: {
  id: string;
  email: string;
  full_name: string;
}): AuthenticatedAdmin {
  return { id: record.id, email: record.email, fullName: record.full_name };
}

/** Mints an access token, a refresh token row, and a CSRF token. */
async function issueSession(
  admin: { id: string; email: string; full_name: string },
  options: { familyId: string; predecessorId?: string | undefined },
  context: RequestContext,
): Promise<IssuedSession> {
  const { token: refreshToken, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL.seconds * 1000);

  await insertRefreshToken({
    adminId: admin.id,
    tokenHash,
    familyId: options.familyId,
    expiresAt,
    predecessorId: options.predecessorId,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  const accessToken = await signAccessToken({ adminId: admin.id, email: admin.email });

  return {
    admin: toAuthenticatedAdmin(admin),
    accessToken,
    refreshToken,
    csrfToken: generateCsrfToken(),
    // Derived from the same configured value used to sign the token, never a
    // literal, so the two cannot disagree.
    expiresInSeconds: config.ACCESS_TOKEN_TTL.seconds,
  };
}

/**
 * Signs an admin in.
 *
 * The unknown-account path still spends a bcrypt comparison, so the response
 * time does not disclose which addresses are registered, and both failure modes
 * raise the same error with the same message.
 *
 * @throws InvalidCredentialsError for a wrong address or a wrong password,
 *   indistinguishably.
 */
export async function signIn(
  credentials: LoginCredentials,
  context: RequestContext,
): Promise<IssuedSession> {
  const admin = await findLiveAdminCredentialByEmail(credentials.email);

  if (admin === undefined) {
    await verifyAgainstDummyHash(credentials.password);
    await recordSecurityEvent(
      {
        eventType: 'login_failure',
        emailAttempted: credentials.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        detail: { reason: 'no_such_account' },
      },
      context.onAuditFailure,
    );
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(credentials.password, admin.password_hash);
  if (!passwordMatches) {
    await recordSecurityEvent(
      {
        eventType: 'login_failure',
        adminId: admin.id,
        emailAttempted: credentials.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        detail: { reason: 'wrong_password' },
      },
      context.onAuditFailure,
    );
    throw new InvalidCredentialsError();
  }

  // A new family per sign-in, so revoking one compromised session cannot affect
  // a session established separately on another device.
  const session = await issueSession(admin, { familyId: randomUUID() }, context);

  await markSignedIn(admin.id);
  await recordSecurityEvent(
    {
      eventType: 'login_success',
      adminId: admin.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    },
    context.onAuditFailure,
  );

  return session;
}

/**
 * Rotates a refresh token.
 *
 * The whole operation runs in one transaction, so there is never a moment in
 * which a session has two live refresh tokens or none.
 *
 * Replay is the case that matters. Presenting an already-revoked token means a
 * token was captured and used twice, so every token descended from that sign-in
 * is destroyed rather than just the one presented. Either the attacker or the
 * legitimate user is then forced to sign in again, and the event is recorded.
 *
 * @throws SessionCompromisedError when a revoked token is replayed.
 * @throws TokenInvalidError when the token is unknown or expired.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const presentedHash = hashRefreshToken(presentedToken);

  const outcome = await withTransaction(async (client) => {
    const stored = await findByHashIncludingRevoked(presentedHash, client);

    if (stored === undefined) {
      return { kind: 'unknown' } as const;
    }

    if (stored.revoked_at !== null) {
      const revokedCount = await revokeFamily(stored.family_id, client);
      return {
        kind: 'replayed',
        adminId: stored.admin_id,
        familyId: stored.family_id,
        revokedCount,
      } as const;
    }

    if (stored.expires_at.getTime() <= Date.now()) {
      // Revoked as well as rejected, so an expired token cannot later be
      // replayed to trigger a spurious family revocation.
      await revokeToken(stored.id, client);
      return { kind: 'expired' } as const;
    }

    const admin = await client.query<{ id: string; email: string; full_name: string }>(
      `select id, email, full_name from admins where id = $1 and deleted_at is null limit 1`,
      [stored.admin_id],
    );
    const adminRow = admin.rows[0];
    if (adminRow === undefined) {
      // The account was deactivated while the session was live.
      await revokeFamily(stored.family_id, client);
      return { kind: 'account_gone' } as const;
    }

    await revokeToken(stored.id, client);

    const { token: refreshToken, tokenHash } = generateRefreshToken();
    await insertRefreshToken(
      {
        adminId: adminRow.id,
        tokenHash,
        familyId: stored.family_id,
        expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL.seconds * 1000),
        predecessorId: stored.id,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
      },
      client,
    );

    return { kind: 'rotated', admin: adminRow, refreshToken } as const;
  });

  if (outcome.kind === 'replayed') {
    await recordSecurityEvent(
      {
        eventType: 'session_compromised',
        adminId: outcome.adminId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        detail: { familyId: outcome.familyId, tokensRevoked: outcome.revokedCount },
      },
      context.onAuditFailure,
    );
    throw new SessionCompromisedError();
  }

  if (outcome.kind !== 'rotated') {
    throw new TokenInvalidError();
  }

  const accessToken = await signAccessToken({
    adminId: outcome.admin.id,
    email: outcome.admin.email,
  });

  return {
    admin: toAuthenticatedAdmin(outcome.admin),
    accessToken,
    refreshToken: outcome.refreshToken,
    csrfToken: generateCsrfToken(),
    expiresInSeconds: config.ACCESS_TOKEN_TTL.seconds,
  };
}

/**
 * Signs out.
 *
 * Revokes server-side state first. Clearing cookies alone is not sign-out: the
 * refresh token would remain valid and anyone holding a copy could mint new
 * access tokens indefinitely.
 */
export async function signOut(
  presentedToken: string | undefined,
  context: RequestContext & { adminId?: string | undefined },
): Promise<void> {
  if (presentedToken !== undefined) {
    const stored = await findByHashIncludingRevoked(hashRefreshToken(presentedToken));
    if (stored !== undefined) {
      await revokeToken(stored.id);
    }
  }

  await recordSecurityEvent(
    {
      eventType: 'logout',
      adminId: context.adminId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    },
    context.onAuditFailure,
  );
}

/**
 * Changes an admin's own password.
 *
 * Verifies the current password, then in one transaction replaces the hash and
 * revokes every refresh token for the account, so no session established under
 * the old password survives it. The caller is then issued a fresh session, so
 * changing a password does not read as being thrown out.
 *
 * @throws InvalidCredentialsError when the current password is wrong.
 */
export async function changePassword(
  input: { adminId: string; currentPassword: string; newPassword: string },
  context: RequestContext,
): Promise<IssuedSession> {
  const admin = await findLiveAdminCredentialById(input.adminId);
  if (admin === undefined) {
    throw new TokenInvalidError('Your account is no longer active.');
  }

  const currentMatches = await verifyPassword(input.currentPassword, admin.password_hash);
  if (!currentMatches) {
    await recordSecurityEvent(
      {
        eventType: 'login_failure',
        adminId: admin.id,
        ipAddress: context.ipAddress,
        requestId: context.requestId,
        detail: { reason: 'wrong_current_password_on_change' },
      },
      context.onAuditFailure,
    );
    throw new InvalidCredentialsError();
  }

  const newHash = await hashPassword(input.newPassword);

  await withTransaction(async (client) => {
    await updatePasswordHash(admin.id, newHash, client);
    await revokeAllForAdmin(admin.id, client);
  });

  await recordSecurityEvent(
    {
      eventType: 'password_changed',
      adminId: admin.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    },
    context.onAuditFailure,
  );

  // A new family: the previous one was just revoked in its entirety.
  return issueSession(admin, { familyId: randomUUID() }, context);
}
