# 0004. Tokens in `HttpOnly` cookies, not `localStorage`

Status: accepted

## Context

The brief requires custom JWT authentication: bcrypt hashing, token issuance, and protected-route middleware. It does not say where the token lives in the browser, which is the decision that actually determines how bad an XSS is.

The reference system this design follows keeps its refresh token in the macOS Keychain, because its client is a native app. A browser has no Keychain.

## Decision

Two tokens, both in cookies the page's JavaScript cannot read.

| Token | Form | Lifetime | Cookie |
|---|---|---|---|
| Access | signed JWT, HS256 | 15 minutes | `HttpOnly`, `SameSite=Lax`, `Secure` outside development |
| Refresh | opaque, 32 random bytes | 7 days | `HttpOnly`, `SameSite=Strict`, path-scoped to the refresh and sign-out routes |

A readable `csrf_token` cookie is issued alongside them and echoed in an `X-CSRF-Token` header on state-changing requests.

## Alternatives considered

**Access token in `localStorage`.**
The common tutorial answer, and the one that makes XSS unsurvivable: any injected script reads the token and exfiltrates a working credential that remains valid until it expires, with no trace on the server. `HttpOnly` means the same XSS can act as the user while the page is open but cannot steal a portable credential.

**Access token in memory only, refresh token in a cookie.**
A legitimate and slightly stronger option: nothing readable exists even transiently. Rejected because every full page load then needs a refresh round trip before the first request, which makes the dashboard slower on exactly the path a reviewer will exercise most, in exchange for closing an attack the `HttpOnly` cookie already closes.

**A JWT as the refresh token.**
Rejected. A JWT is valid because it verifies, which means it cannot be revoked. The refresh token has a seven-day life and is the thing worth stealing, so it must be revocable. An opaque random value stored as a digest is revocable by deleting a row, which is what makes family theft detection possible at all.

**`SameSite=Strict` on both cookies.**
Rejected for the access token. A top-level navigation from outside the app would not carry it, so an evaluator following a link to a dashboard route would appear signed out. `Lax` sends the cookie on top-level navigation but not on a cross-site POST, which is the case that matters.

## Consequences

Tokens are never readable by script, so an XSS cannot produce a portable credential.

`SameSite` already blocks cross-site POST, and the double-submit CSRF token is a second layer that does not depend on the browser honouring `SameSite` correctly.

Cookies must be first-party for any of this to hold, which is what forces the same-origin hosting decision in [0003](0003-deployment-topology.md).

Refresh tokens are stored only as a SHA-256 digest. A plain digest rather than bcrypt is correct here because the input is 32 bytes of CSPRNG output: there is no low-entropy guess space for a slow hash to defend, and the `octet_length(token_hash) = 32` constraint in `schema.sql` means a raw token cannot be stored by mistake.

The client needs a single-flight refresh interceptor, because several requests can fail with an expired token at the same moment and must not each trigger their own rotation.
