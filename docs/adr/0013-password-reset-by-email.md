# 0013. Self-service password reset by email, reversing the "no email provider" constraint

Status: accepted

## Context

`requirements.md`'s extended scope was written under one explicit constraint: this system has no email delivery provider, so password recovery is an operator-run command (`npm run db:reset-password`) and nothing in the design depends on sending mail. That was true when it was written.

The project owner separately holds `kiomeet.com` and has a Resend account with a verified sending domain, `mail.kiomeet.com`, already configured there (DKIM, SPF and the Resend domain-verification DNS records were in place before this feature was requested). The constraint that justified the operator-only design no longer holds.

## Decision

Add a conventional "forgot password" email flow (Requirement 19) without removing the operator command (Requirement 17, criteria 7 to 9), which remains the fallback for when email delivery is not configured or does not reach someone.

- **Resend**, via its official `resend` npm package (v6.35.0 at the time of writing, Node >=20, no hard dependency beyond the optional `@react-email/render`, which this project does not install since it sends plain text/HTML directly rather than through React Email templates).
- **Token shape copies `refresh_tokens` exactly**: 32 random bytes, SHA-256 hash stored, never the raw value, single-use, time-limited. The pattern already exists in this codebase and is already reasoned about in `docs/reference/reference-refresh-tokens.sql`'s lineage; a reset token has the same threat model (a long-lived credential that must be unguessable and revocable) and earns no benefit from a different design.
- **The HTTP response from the request step never reveals account existence**, matching the sign-in design. What it cannot hide: whether a reset email actually lands in an inbox, to whoever controls that inbox. That is an inherent property of email-based reset, not a gap in this implementation, and is recorded as such in `design.md` section 11.6 rather than silently accepted.
- **Rate limiting keys on network address, not on the submitted email**, for both the request and redemption steps. Keying the request step on the email itself would let an attacker distinguish "this address is rate-limited" from "this address is not," which leaks exactly the account-existence signal the generic response is trying to avoid.

## Alternatives considered

**Keep the operator command as the only path and skip this entirely.**
Rejected once the user asked for it: a verified sending domain exists, the operator-only design was a workaround for not having one, and a dashboard editable only by someone with `psql` access is a worse experience than the brief needs once the workaround is unnecessary.

**A third-party auth provider's built-in password reset (e.g., swap to a hosted auth service).**
Rejected for the same reason the rest of authentication in this project is hand-rolled: `requirements.md` R4.1 requires auth be implemented in this system's own backend, and that requirement was not revisited, only the email constraint was.

**Send through SMTP directly (nodemailer) instead of Resend's API.**
Rejected: the user's domain is already verified with Resend specifically (DKIM and SPF records point at it), so using a different sender would need its own domain verification from scratch for no benefit. Resend's API is also simpler to call correctly (no SMTP connection pooling or TLS negotiation to get wrong) for a project sending one kind of transactional email.

**Use `@react-email/render` and JSX email templates.**
Rejected as more machinery than one email template needs. It is an optional peer dependency of `resend` specifically so projects that do not need it are not forced to install it.

## Consequences

Four new required environment variables (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PASSWORD_RESET_TOKEN_TTL`, `APP_BASE_URL`), one new table, two new public endpoints each with their own rate limiter, and one new security event type. The operator command from Requirement 17 is unchanged and stays documented as the fallback.
