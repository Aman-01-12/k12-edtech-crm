# EdTech CRM and Inquiry System

A public inquiry form and a JWT-protected admin dashboard for an EdTech organisation, on PostgreSQL.

Prospective parents, students and schools submit an inquiry without signing in.
Staff sign in to a separate dashboard to read, filter, search, triage and export those inquiries.

Authentication is implemented in this codebase from the hash upward: bcrypt password verification, JWT issuance and verification, refresh-token rotation with theft detection, and protected-route middleware.
No authentication provider or ORM is used.

---

## Live demo

| | |
|---|---|
| **Application** | _filled in below once deployed_ |
| **API health** | _filled in below once deployed_ |

Sign in on the **Admin** link in the header.

| | |
|---|---|
| Email | `demo.admin@example.com` |
| Password | _supplied in the submission email, not committed_ |

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Authentication, demonstrated with curl](#authentication-demonstrated-with-curl)
- [Database schema](#database-schema)
- [Security](#security)
- [Performance](#performance)
- [Verification](#verification)
- [Deployment](#deployment)
- [Decision records](#decision-records)
- [Known limits](#known-limits)

---

## What it does

### Public inquiry form

One page, no account needed.
Collects user type (Parent, Student, School), inquiry category (Scholarship, Concert, Admission, General Query), name, email, phone and message.

- Every field is validated by the same Zod schema on the client and on the server, so the hint shown while typing is the rule that is actually enforced.
- Phone numbers are normalised to E.164 (`+919876543210`) on the way in, so one person's number has exactly one stored representation and admin search cannot miss a row because of formatting.
- A retried submission with the same `X-Idempotency-Key` returns the original row rather than creating a duplicate.
- A hidden honeypot field catches bots that fill every input, without a captcha and without penalising anyone on a shared IP address.

### Admin dashboard

Behind sign-in.

- **List** every inquiry, newest first, keyset-paginated.
- **Filter** by category and by user type.
- **Search** by name, email or phone. Phone search accepts any formatting.
- **Change status** along `New -> In Progress -> Resolved -> Closed`, shown as a rail rather than a dropdown because the status is a genuine sequence.
- **Summary counts** per status, per category and per user type, for the current filter.
- **Export to CSV**, respecting the current filter, with spreadsheet formula injection neutralised.
- **Manage admins**: list, invite (the server generates the password and shows it once), deactivate. There is no public sign-up.
- **Change your own password**, which requires the current one and reissues the session.

---

## Architecture

```
                        Browser
                           |
                    (same origin, HTTPS)
                           |
         +-----------------+------------------+
         |                                    |
  Static React bundle                  /api/* rewritten
  (Vercel CDN)                         to the API deployment
                                              |
                                      Express on Node 24
                                      (Vercel Function, hnd1)
                                              |
                                      Supabase Postgres 17
                                      (Supavisor pooler, ap-northeast-1)
```

The browser only ever makes **same-origin** requests.
The frontend deployment rewrites `/api/*` to the API deployment at the edge, so the session cookies are first-party and therefore unaffected by third-party cookie blocking in Safari and Firefox.
Locally, Vite's dev-server proxy reproduces the same arrangement, so cookie behaviour in development matches production instead of diverging from it.
Reasoning and rejected alternatives: [ADR 0003](docs/adr/0003-deployment-topology.md).

Layers flow inward only.

```
routes  ->  services  ->  repositories  ->  pg pool
```

`req` and `res` never reach a service, and SQL never leaves a repository.
This is enforced by an ESLint `no-restricted-imports` boundary rule, not by convention, and the rule was negative-tested by deliberately adding a violating import and confirming lint failed.

Validation schemas live in a third workspace package, `@k12/contracts`, imported by both sides.
Types are derived from the schemas with `z.output<...>`, so a validator and its TypeScript type cannot disagree.

---

## Stack

| | | Why |
|---|---|---|
| Runtime | Node 24 LTS | current LTS line; version pinned in `.nvmrc` |
| Language | TypeScript 6.0.3, `strict` plus `erasableSyntaxOnly`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` | TypeScript 7 ships no stable compiler API, so type-aware linting cannot run against it - [ADR 0001](docs/adr/0001-typescript-version.md) |
| API | Express 5 | native async error propagation, so no `try/catch` wrapper per route |
| Database access | `pg` with hand-written SQL | `schema.sql` is a required deliverable; an ORM would create a second, competing definition of the schema - [ADR 0002](docs/adr/0002-postgres-access-without-an-orm.md) |
| Database | Supabase PostgreSQL 17 | |
| JWT | `jose` | audited, zero-dependency, pins the algorithm at verification time |
| Passwords | `bcrypt`, cost 12 | |
| Validation | Zod 4, shared between client and server | |
| Frontend | React 19, Vite 8, React Router 8, TanStack Query 5, React Hook Form 7 | |
| Styling | Tailwind CSS 4 | |
| Quality gates | ESLint 10 type-aware, Prettier 3, Vitest 4 | |

---

## Repository layout

```
.
|-- schema.sql                  the complete database schema, idempotent
|-- .env.example                every variable, documented, no values
|-- packages/contracts/         Zod schemas and types shared by both sides
|-- backend/
|   `-- src/
|       |-- app.ts              Express app; the serverless entry point
|       |-- server.ts           local entry point: binds a port, handles SIGTERM
|       |-- config/env.ts       environment parsed once at startup, fails fast
|       |-- db/                 pool and transaction helper
|       |-- errors/             the error taxonomy
|       |-- lib/                cursor, CSV, LIKE escaping, rate-limit store
|       |-- middleware/         auth, CSRF, honeypot, rate limit, validation
|       |-- modules/            auth, inquiries, admins, health
|       `-- scripts/            seed-admin, reset-password
|-- frontend/
|   `-- src/
|       |-- lib/api-client.ts   fetch wrapper with single-flight token refresh
|       |-- components/         Field, Button, StatusRail
|       `-- features/           inquiry-form, auth, dashboard, settings
|-- docs/adr/                   architecture decision records
`-- .github/workflows/ci.yml    verify, audit and schema-apply on every push
```

---

## Running it locally

### Prerequisites

- Node 24 or newer (`nvm use` reads `.nvmrc`)
- A PostgreSQL 15+ database, local or Supabase
- `psql`, to apply the schema

### Setup

```sh
git clone https://github.com/Aman-01-12/k12-edtech-crm.git
cd k12-edtech-crm
nvm use
npm install
```

Create the environment file and fill it in.

```sh
cp .env.example .env
```

At minimum you need `DATABASE_URL` and `JWT_SECRET`.
Generate a signing secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Apply the schema, then create the first admin.

```sh
set -a && . ./.env && set +a
npm run db:schema
SEED_ADMIN_EMAIL=you@example.com \
SEED_ADMIN_PASSWORD='Choose-A-Password-12' \
SEED_ADMIN_FULL_NAME='Your Name' \
npm run db:seed
```

`schema.sql` is idempotent: re-applying it to an existing database is a no-op, verified by applying it three times in a row and diffing the resulting catalogue.

Run both applications.

```sh
npm run dev
```

| | |
|---|---|
| Form | http://localhost:5173 |
| Dashboard | http://localhost:5173/admin |
| API | http://localhost:4000/api/health |

Forgot the admin password? There is no email delivery in this system, so recovery is an operator action:

```sh
RESET_ADMIN_EMAIL=you@example.com \
RESET_ADMIN_PASSWORD='A-New-Password-12' \
npm run db:reset-password
```

Both values come from the environment rather than from arguments, so neither lands in shell history, and the script never echoes the password back.
It revokes every existing session for that account, so the old password cannot keep a stolen session alive.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | both applications, with reload |
| `npm run verify` | format check, lint, type-check, unit tests - the full gate |
| `npm run build` | production frontend bundle |
| `npm run db:schema` | apply `schema.sql` to `$DATABASE_URL` |
| `npm run db:seed` | create the first admin from `SEED_ADMIN_*` |
| `npm run db:reset-password` | reset one admin's password and revoke its sessions |

---

## Environment variables

Every variable is listed, explained and grouped in [`.env.example`](.env.example), which carries names and comments only and never a value.

The backend parses all of them through a Zod schema once at startup and **refuses to start** if one is missing or malformed, naming the offending variable.
A misconfigured deployment fails at boot rather than at the first request that happens to need the value.

Two that are easy to get wrong:

- **`DATABASE_URL` must use the pooler host, not `db.<ref>.supabase.co`.** The direct endpoint publishes only an AAAA record, so it is IPv6-only without the paid IPv4 add-on and fails on IPv4-only networks with a timeout that reads like a wrong password.
- **The password inside `DATABASE_URL` must be percent-encoded.** It is a URI, so `@ : / ? # [ ]` must be escaped. An unescaped `@` makes the driver report a nonexistent host.

`JWT_SECRET` must be at least 32 bytes and has no default and no fallback, because a guessable signing key means anyone can mint a valid admin token.

---

## API reference

Base path `/api/v1`. All bodies are JSON. All responses carry `X-Request-Id`.

### Public

| Method | Path | |
|---|---|---|
| `GET` | `/api/health` | liveness plus a real database round-trip |
| `POST` | `/api/v1/inquiries` | submit an inquiry; `201` when stored, `200` on an idempotent replay |

### Session

| Method | Path | |
|---|---|---|
| `POST` | `/api/v1/auth/login` | sets the session cookies, returns the admin and `expiresIn` |
| `POST` | `/api/v1/auth/refresh` | rotates the refresh token and reissues the access token |
| `POST` | `/api/v1/auth/logout` | revokes the token family and clears the cookies |
| `GET` | `/api/v1/auth/me` | the current session |
| `POST` | `/api/v1/auth/change-password` | requires the current password; reissues the session |

### Admin, authentication required

| Method | Path | |
|---|---|---|
| `GET` | `/api/v1/inquiries` | keyset-paginated list; `category`, `userType`, `search`, `limit`, `cursor` |
| `GET` | `/api/v1/inquiries/summary` | counts by status, category and user type for the same filter |
| `GET` | `/api/v1/inquiries/export` | CSV of the current filter |
| `PATCH` | `/api/v1/inquiries/:id/status` | change one inquiry's status |
| `GET` | `/api/v1/admins` | list active admins |
| `POST` | `/api/v1/admins` | create an admin; returns the generated password once |
| `DELETE` | `/api/v1/admins/:id` | deactivate an admin and revoke its sessions |

The list query is **strict**: `?userTyp=parent` is a `400`, not a silently unfiltered result set, because a filter that looks applied but is not is the worse failure.

### Error shape

Every failure, from every endpoint, returns the same body.

```json
{
  "error": "Human-readable message, safe to display.",
  "code": "VALIDATION_FAILED",
  "requestId": "a1b2c3d4-...",
  "details": { "phone": ["Enter a valid 10-digit Indian mobile number."] }
}
```

`code` is the stable identifier a client branches on; `error` is for display; `requestId` is what a user quotes and what correlates the response with the server log line explaining it.
`details` appears only on a validation failure.

Codes: `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_COMPROMISED`, `CSRF_TOKEN_INVALID`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`.

`TOKEN_EXPIRED` and `TOKEN_INVALID` are deliberately distinct.
The first means refresh and replay; the second means the session is unrecoverable and the user must sign in again.
Collapsing them into one code is what produces clients that either loop on refresh or sign the user out unnecessarily.
Full taxonomy: [ADR 0008](docs/adr/0008-error-contract.md).

---

## Authentication, demonstrated with curl

The tokens live in `HttpOnly` cookies, so `curl` needs a cookie jar.
Replace `$BASE` with the live API origin or `http://localhost:4000`.

**1. Submit an inquiry with no credentials at all. This is public.**

```sh
curl -sS -X POST "$BASE/api/v1/inquiries" \
  -H 'Content-Type: application/json' \
  -d '{"userType":"parent","category":"admission","fullName":"Asha Menon",
       "email":"asha@example.com","phone":"98765 43210",
       "message":"Could you share the admission timeline for the next session?"}'
```

```
201  {"inquiry":{"id":"...","phone":"+919876543210","status":"new", ...}}
```

Note the phone number came back canonicalised.

**2. Read the inquiry list without a token. This is rejected.**

```sh
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/inquiries"
```

```
401
```

```json
{ "error": "You are not signed in.", "code": "TOKEN_INVALID", "requestId": "..." }
```

**3. Sign in.**

```sh
curl -sS -c jar.txt -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo.admin@example.com","password":"<password>"}'
```

```json
{
  "admin": { "id": "...", "email": "demo.admin@example.com", "fullName": "Demo Admin" },
  "expiresIn": 900
}
```

No token in the body, by design.
Three cookies were set instead:

| Cookie | Contents | Attributes |
|---|---|---|
| `k12_access` | the HS256 JWT | `HttpOnly` `Secure` `SameSite=Lax` `Path=/` `Max-Age=900` |
| `k12_refresh` | 32 opaque random bytes | `HttpOnly` `Secure` `SameSite=Strict` `Path=/api/v1/auth` |
| `k12_csrf` | the double-submit value | `Secure` `SameSite=Lax`, deliberately readable by the page |

`expiresIn` is derived from configuration, never hardcoded, so the client can refresh ahead of expiry rather than waiting for a `401`.

**4. Call the protected endpoint with the cookie jar.**

```sh
curl -sS -b jar.txt "$BASE/api/v1/inquiries?limit=2"
```

```json
{ "items": [ { "id": "...", "fullName": "Asha Menon", "status": "new" } ], "nextCursor": "..." }
```

**5. Tamper with the token. One flipped character in the signature.**

```sh
sed 's/\(k12_access[[:space:]]*[A-Za-z0-9._-]*\)./\1X/' jar.txt > tampered.txt
curl -sS -b tampered.txt "$BASE/api/v1/inquiries"
```

```
401  {"error":"Your session is no longer valid.","code":"TOKEN_INVALID","requestId":"..."}
```

The verifier pins the algorithm to `HS256` and requires the issuer and audience claims, so a token signed with `alg: none`, re-signed as `HS512`, or minted by another system with the same secret is rejected as well.
There are 22 unit tests covering exactly these forgeries.

**6. A write needs the CSRF header as well as the cookie.**

```sh
curl -sS -b jar.txt -X PATCH "$BASE/api/v1/inquiries/$ID/status" \
  -H 'Content-Type: application/json' -d '{"status":"in_progress"}'
```

```
403  {"error":"...","code":"CSRF_TOKEN_INVALID","requestId":"..."}
```

With the header echoed from the readable cookie, it succeeds.

```sh
CSRF=$(awk '/k12_csrf/ {print $7}' jar.txt)
curl -sS -b jar.txt -X PATCH "$BASE/api/v1/inquiries/$ID/status" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"status":"in_progress"}'
```

```
200  {"inquiry":{"id":"...","status":"in_progress","statusUpdatedAt":"..."}}
```

**7. Rotate the refresh token, then replay the old one.**

```sh
cp jar.txt old.txt
curl -sS -b jar.txt -c jar.txt -X POST "$BASE/api/v1/auth/refresh"   # 200, new pair issued
curl -sS -b old.txt  -X POST "$BASE/api/v1/auth/refresh"             # 401 SESSION_COMPROMISED
curl -sS -b jar.txt  "$BASE/api/v1/inquiries"                        # 401 - the family is dead
```

A refresh token is single-use.
Presenting a token that has already been rotated means either a replay or a stolen token, and since the server cannot tell which, it revokes **every** token in that family, including the one the legitimate user holds.
Signing in again is the recovery.
The event is written to the append-only `security_events` table.

**8. Sign out.**

```sh
curl -sS -b jar.txt -X POST "$BASE/api/v1/auth/logout" -H "X-CSRF-Token: $CSRF"   # 204
curl -sS -b jar.txt "$BASE/api/v1/inquiries"                                      # 401
```

---

## Database schema

The complete schema is one file, [`schema.sql`](schema.sql), applied with `npm run db:schema`.
It is idempotent and has been applied to both PostgreSQL 15 and PostgreSQL 17; the resulting catalogue is byte-identical on both.

| Table | |
|---|---|
| `admins` | accounts; bcrypt hash, soft-deleted via `deleted_at` because the audit log and the inquiry status trail reference them |
| `inquiries` | submissions, with status and an audit of who changed it when |
| `refresh_tokens` | SHA-256 digests, `family_id`, `predecessor_id` chain, `revoked_at` |
| `security_events` | append-only audit log |
| `rate_limit_hits` | sliding-window counters |

Throughout:

- Enum-like columns are `TEXT` with `CHECK` constraints rather than native enum types, so an invalid status cannot be written even by hand in `psql`, and adding a permitted value is an explicit migration rather than an `ALTER TYPE`.
- `admins.password_hash` is `CHECK`-constrained to the bcrypt modular-crypt shape, pinning the `$2a$`/`$2b$`/`$2y$` prefix, the two-digit cost and the 53-character tail. Writing a plaintext password into that column fails at the database level.
- Every table has `created_at`, and the mutable ones have `updated_at` maintained by a trigger rather than by application code, so a hand-written `UPDATE` cannot leave a stale timestamp.
- No token or password is stored in a recoverable form. `refresh_tokens.token_hash` is a `bytea` SHA-256 digest; the plaintext exists only in the client's cookie.
- `security_events` is genuinely append-only. `REVOKE` cannot bind the table owner, so `UPDATE`, `DELETE` and `TRUNCATE` are blocked by statement-level triggers that raise instead.
- Row-level security is enabled on every table, and `anon` and `authenticated` hold zero grants: the API connects as the owner and is the only path to the data. Supabase's advisor flags "RLS enabled, no policy" on these tables; that is the intended configuration, not an oversight.

Indexes are chosen to match the queries that actually run, and were verified with `EXPLAIN (ANALYZE, BUFFERS)` against 200,000 generated rows rather than assumed:

| Index | Serves |
|---|---|
| `inquiries_created_at_id_idx` | the default newest-first listing and every keyset page |
| `inquiries_full_name_trgm_idx`, `inquiries_phone_trgm_idx` | GIN trigram, for substring search |
| `inquiries_idempotency_key_key` | partial unique, which is what makes retried submissions idempotent |
| `refresh_tokens_*` | three partial indexes: active-by-admin, by family, by expiry |

Two composite filter indexes were written, measured, and **removed**: the planner never chose them, the combination was measurably dearer than the ordering index alone (cost 10.37 against 8.60), `pg_stat_user_indexes` recorded zero scans, and they cost 3,240 kB plus write amplification on every insert.

---

## Security

| | |
|---|---|
| Passwords | bcrypt cost 12; input capped at 72 bytes, because bcrypt silently discards the rest and two passwords sharing a 72-byte prefix would otherwise be interchangeable |
| Unknown accounts | compared against a dummy hash, so a wrong email and a wrong password take the same time and return the same message - the account-existence oracle is closed |
| Access token | HS256 JWT, 15 minutes, `HttpOnly` cookie, never `localStorage` |
| Token verification | algorithm, issuer and audience all pinned and required |
| Refresh token | 32 opaque random bytes, stored only as a SHA-256 digest, single-use, rotated atomically; reuse revokes the whole family |
| CSRF | double-submit token required on every state-changing request |
| SQL | parameterised exclusively; no identifier, sort direction or operator is ever interpolated from request data. A `'; DROP TABLE inquiries; --` payload is stored verbatim as a name, which is covered by a test |
| Input | every payload, query string, path parameter, cookie, header and environment variable validated by a schema at its boundary; strict objects, so unknown keys are rejected rather than stripped |
| Rate limiting | sliding window in Postgres, so the limit is correct across concurrent function instances. Keyed on the most specific available identity: submission by network, sign-in by **both** account and network, export by admin id. Fails open if the store is unavailable |
| Headers | `helmet`, CSP `default-src 'none'`, HSTS one year with `includeSubDomains; preload`, `X-Content-Type-Options`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` |
| CORS | exact allowlist. The request's own `Origin` is never reflected, because reflecting it alongside `credentials: true` makes the allowlist meaningless |
| Caching | `Cache-Control: no-store` on every API response, so an inquiry list is never left in a shared cache |
| Body size | capped before parsing, because the public submission endpoint is unauthenticated |
| Errors | sanitised: no stack trace, driver message, SQL or internal hostname ever reaches a client. Every failure path fails closed |
| Logs | structured JSON with credentials, tokens and cookie headers redacted by path |
| Database TLS | certificate verified by default. An unverified connection is possible only by setting `DATABASE_SSL_NO_VERIFY`, which logs a warning on every boot - [ADR 0011](docs/adr/0011-database-tls-verification.md) |
| CSV export | values beginning `= + - @` or a control character are neutralised, so a crafted message cannot execute as a formula when the file is opened in Excel |
| Audit | sign-in success and failure, refresh reuse, rate-limit trips, status changes, exports and admin changes are written to an append-only table |

### Why the rate limiting is shaped the way it is

The first design was a fixed-window counter keyed on IP address, with sign-in keyed on email.
Measuring it found three defects, so it was rebuilt.
[ADR 0005](docs/adr/0005-rate-limiting-and-idempotency.md) has the detail; in short:

1. A fixed window admits twice the limit across a window boundary. A sliding window does not.
2. Keying on a raw IP address punishes exactly our audience. Cloudflare's data shows a single carrier-grade NAT IPv4 address can front hundreds or thousands of users, and that this is most pronounced on mobile networks in developing regions. Meanwhile an attacker on IPv6 gets a free `/64` to rotate through. The fix is to key on the `/64` prefix, not the address, and to prefer a more specific identity whenever one exists.
3. Keying sign-in on the email address alone misses credential stuffing, which spreads one attempt across thousands of accounts. Sign-in is therefore limited on both axes at once, and a successful attempt does not consume the allowance.

Account lockout was considered and rejected: it hands an attacker a denial-of-service lever against a named user.
A captcha is held in reserve as an escalation rather than imposed on every visitor.

---

## Performance

Measured, not assumed.

| | |
|---|---|
| Deep pagination | keyset at page 7,500 of 200,000 rows: **0.083 ms**. The same page by `OFFSET 150000`: **26.7 ms**, 320x slower. The API has no `OFFSET` path |
| Substring name search | GIN trigram index: **1.4 ms**. Without it, a parallel sequential scan: **18.1 ms** |
| Frontend bundle | 645 kB raw, **197 kB gzipped**. The three admin routes are lazily split, so a visitor who only submits the form never downloads the dashboard |
| Database pool | bounded, with a connection-acquisition timeout and a server-side `statement_timeout`, so one pathological query cannot hold a connection indefinitely |
| Lists | always bounded and paginated; no endpoint can return an unbounded result set |
| Queries | named columns only, never `SELECT *`; no N+1 |

---

## Verification

```sh
npm run verify     # format check + lint + type-check + unit tests
```

Lint runs type-aware with `--max-warnings=0`, which includes the layer-boundary rule.

Beyond the gate, every behavioural claim in this README is backed by something that was executed against a running stack, not by reading the code:

| | |
|---|---|
| Schema | 28 assertions over the live catalogue - every constraint, trigger, index and grant - on PostgreSQL 15 and 17 |
| Authentication | 15 live HTTP checks: sign-in, wrong password, unknown account, refresh rotation, replay detection, CSRF, logout, `/me` |
| Inquiries | 49 live HTTP checks: validation per field, idempotency, filters, search, cursor paging, status transitions, CSV contents and headers |
| Admin management | 33 live HTTP checks: create, duplicate, list, deactivate, self-deactivation, session revocation |
| Query plans | 15 `EXPLAIN (ANALYZE, BUFFERS)` runs against 200,000 rows, confirming the intended index was chosen |
| Browser | 25 Playwright assertions over the real UI, plus screenshot review, which is how two visual defects were found and fixed: a clipped status label and a wrapping button |
| Unit | 180 Vitest tests, including 22 JWT forgery cases and the phone, CSV, cursor and `LIKE`-escaping edge cases |

The test suite is in `tests/` and is deliberately excluded from this repository, per the submission instructions.
`npm test` therefore passes as a no-op on a clean clone.
The numbers above are what those tests reported when they ran.

---

## Deployment

Two Vercel projects from this one repository.

| Project | Root directory | |
|---|---|---|
| `k12-edtech-crm` | `frontend` | static bundle on the CDN; rewrites `/api/*` to the API |
| `k12-edtech-crm-api` | `backend` | Express as a single Vercel Function, region `hnd1` |

`hnd1` (Tokyo) is chosen to sit beside the Supabase project in `ap-northeast-1`, so the database round-trip does not cross an ocean.

The API deployment needs `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production` and `CORS_ALLOWED_ORIGINS`.
`.github/workflows/ci.yml` runs the full gate, an `npm audit`, and a schema application against a throwaway PostgreSQL service on every push.

---

## Decision records

Eleven decisions that a reasonable engineer could have made differently are written up in [`docs/adr/`](docs/adr/), each naming the alternatives considered and the trade-off accepted.
The point is not to prove the choice was right, but to show it was a choice rather than a default.

| | |
|---|---|
| [0001](docs/adr/0001-typescript-version.md) | TypeScript 6, not the newer 7 |
| [0002](docs/adr/0002-postgres-access-without-an-orm.md) | Hand-written SQL over `pg`, not an ORM |
| [0003](docs/adr/0003-deployment-topology.md) | Two Vercel projects, same-origin via rewrite |
| [0004](docs/adr/0004-token-transport.md) | Tokens in cookies, not `localStorage` |
| [0005](docs/adr/0005-rate-limiting-and-idempotency.md) | Postgres-backed sliding-window rate limiting |
| [0006](docs/adr/0006-phone-number-validation.md) | India-only phone validation, canonical E.164 storage |
| [0007](docs/adr/0007-single-principal-authorization.md) | No role column |
| [0008](docs/adr/0008-error-contract.md) | A house error shape, not RFC 9457 |
| [0009](docs/adr/0009-visual-design-direction.md) | Slate and marigold, with a status rail |
| [0010](docs/adr/0010-admin-management-authorization.md) | Every admin can manage admins |
| [0011](docs/adr/0011-database-tls-verification.md) | Database TLS verified by default |

---

## Known limits

Stated plainly, because an unstated limit reads as an oversight.

- **No email delivery.** Password recovery is an operator action (`npm run db:reset-password`), and a new admin's generated password is shown once in the UI for the inviting admin to pass on. Wiring a transactional email provider is the obvious next step; nothing in the design assumes its absence.
- **Phone validation is India-only.** It matches the audience, and E.164 storage means widening it later is a schema-compatible change. [ADR 0006](docs/adr/0006-phone-number-validation.md) records the upgrade path.
- **One privilege level.** Every admin can manage admins. With a single internal team this is honest; a column with one possible value is an unused field pretending to be a feature. [ADR 0010](docs/adr/0010-admin-management-authorization.md).
- **The Supabase free tier pauses a project after seven days of inactivity.** If the live demo returns a database error, the project needs resuming from the dashboard.
- **CSV export is capped** at `EXPORT_ROW_LIMIT` rows and sets `X-Export-Truncated` when the cap is hit, rather than streaming an unbounded result set through a serverless function.

---

## Licence

MIT. See [`LICENSE`](LICENSE).
