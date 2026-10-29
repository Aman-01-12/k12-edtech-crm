# Architecture decision records

One record per decision that a reasonable engineer could have made differently.
Each states what was decided, what else was considered, and what trade-off was accepted.

The point is not to prove the choice was right.
It is to show it was a choice rather than a default, so a reviewer who disagrees can see the reasoning and argue with it.

| # | Decision |
|---|---|
| [0001](0001-typescript-version.md) | TypeScript 6, not the newer 7 |
| [0002](0002-postgres-access-without-an-orm.md) | Hand-written SQL over `pg`, not an ORM |
| [0003](0003-deployment-topology.md) | Two Vercel projects, same-origin via rewrite |
| [0004](0004-token-transport.md) | Tokens in cookies, not `localStorage` |
| [0005](0005-rate-limiting-and-idempotency.md) | Sliding-window rate limiting in Postgres, unique index for idempotency |
| [0006](0006-phone-number-validation.md) | India-only phone validation, canonical E.164 storage |
| [0007](0007-single-principal-authorization.md) | No role column |
| [0008](0008-error-contract.md) | A house error shape, not RFC 9457 |
| [0009](0009-visual-design-direction.md) | Slate and marigold, with a status rail |
| [0010](0010-admin-management-authorization.md) | Every admin can manage admins |
| [0011](0011-database-tls-verification.md) | Database TLS verified by default |
| [0012](0012-vercel-function-bundling.md) | The deployed API function is a committed esbuild bundle |
| [0013](0013-password-reset-by-email.md) | Self-service password reset by email via Resend |
| [0014](0014-record-panel-and-flat-surfaces.md) | A record panel for enquiry actions, flat surfaces instead of nested cards |
