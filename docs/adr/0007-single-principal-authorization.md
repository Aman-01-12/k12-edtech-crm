# 0007. No role column

Status: accepted

## Context

The reference system this design follows has tiers and a `requireTier` middleware, and its checklist calls for `requireRole('admin')`. Mirroring that here would mean a `role` column on `admins` and a role claim in the token.

The brief describes one kind of user: an admin who signs in to view and manage inquiries. There is no second principal.

## Decision

No `role` column. Authorization is "is a live admin", asserted by middleware from the verified token claim plus a check that the account still exists and is not soft-deleted.

## Alternatives considered

**A `role` column constrained to a single value `'admin'`.**
This is the version that looks like good practice and is not. A column that can only ever hold one value carries no information, so the `CHECK` constraint, the token claim and the middleware comparison are all ceremony around a constant. It is precisely the unused field that a reviewer should flag, and adding it to look thorough is the wrong instinct.

**Roles with a real distinction, such as `viewer` and `admin`.**
Genuinely useful for a CRM: a viewer could read inquiries without changing status. Rejected as scope creep. The brief says an admin can view *and manage*, so a read-only role answers a question nobody asked, and inventing an authorization dimension is how a small feature set grows an access-control model nobody specified.

**A permissions table for future flexibility.**
Rejected on the same grounds, more so. Speculative generality in an access-control model is worse than elsewhere, because the untested paths are the ones that matter.

## Consequences

The authorization check is as simple as it can be, which is the point: it is one condition, applied by one middleware, on every protected route, and that is easy to verify exhaustively. The security regression suite asserts every protected route returns 401 unauthenticated.

Soft delete is load-bearing. Because the middleware re-reads the admin on each request, deactivating an account invalidates its unexpired access token at the next request rather than at expiry, which is what makes [0010](0010-admin-management-authorization.md)'s deactivation immediate.

Adding a second role later is a migration plus a middleware argument. That friction is appropriate for a change that alters who can do what.
