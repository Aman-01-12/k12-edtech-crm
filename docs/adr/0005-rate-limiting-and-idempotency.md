# 0005. Postgres-backed rate limiting, a unique index for idempotency

Status: accepted

## Context

The public submission endpoint is unauthenticated and world-writable, which makes it the spam and resource-exhaustion surface. Sign-in accepts credentials, which makes it the brute-force surface. Both need rate limiting.

Separately, a submission that times out on the network has to be retriable without creating a duplicate inquiry. The client cannot tell a lost request from a lost response, so it must be safe to send again.

The reference system solves both with Redis. This project provisions only Postgres, and adding Redis for two counters would be a new service, a new credential, and a new failure mode.

## Decision

**Rate limiting:** `express-rate-limit` with a custom `Store` backed by a `rate_limit_hits` table declared in `schema.sql`. Fixed windows, keyed `(bucket_key, window_start)`.

The increment is one statement, which is what makes it correct under concurrency:

```sql
insert into rate_limit_hits (bucket_key, window_start, hit_count)
values ($1, $2, 1)
on conflict (bucket_key, window_start)
do update set hit_count = rate_limit_hits.hit_count + 1
returning hit_count;
```

If the store errors, the request is allowed and a warning is logged. Availability beats enforcement for a counter.

**Idempotency:** a partial unique index on `inquiries(idempotency_key) where idempotency_key is not null`. A replayed key raises a unique violation, which the repository translates into re-reading and returning the original row.

## Alternatives considered

**The default in-memory store.**
Wrong the moment there is more than one instance, which for a serverless deployment is always. Four warm instances means roughly four times the advertised limit gets through, so the limit documented would not be the limit enforced.

**`@acpr/rate-limit-postgresql`, the published Postgres store.**
Considered seriously, then rejected. It pins its own copy of `pg` as a direct dependency, and it runs its own migrations through `postgres-migrations`, creating tables outside `schema.sql`. That breaks the thing the brief actually asks for, which is one schema file describing the database. Its issue tracker also carries migration-failure reports. A fifty-line store against a table we already declare is less code and less risk.

**A sliding-window or token-bucket algorithm.**
More precise: a fixed window admits up to twice the limit across a boundary. Rejected because it needs either per-request timestamp rows or Redis sorted sets, and the purpose here is abuse resistance rather than a metered quota. `express-rate-limit`'s own store is a fixed window too, so this matches the library's semantics rather than fighting them.

**Caching the full response per idempotency key, as the reference system does.**
Appropriate for Redis with a TTL. Rejected here because it stores a second copy of the answer and then needs an expiry policy. The unique index makes the database itself the guarantee: it is not possible for two rows to share a key, so exactly-once is structural rather than enforced by application logic that could be bypassed.

## Consequences

The limit holds across instances, because the counter is in the one place every instance shares.

Rate limiting fails open. That is deliberate and worth stating plainly: a database blip must not lock every admin out of sign-in. The trade is that an attacker who can break the counter can also evade the limit, which is an acceptable exchange for a counter and would not be for an authorization check.

Fixed windows allow a boundary burst of up to twice the limit. Documented rather than hidden.

Expired rows accumulate and are swept by window age; the table is indexed on `window_start` for exactly that.

Keys are scoped by purpose (`submit:<ip>`, `login:<email>`), so one subject's limit cannot be consumed by traffic to a different endpoint. Sign-in keys on the lowercased email rather than the IP, so one attacker cannot lock out every user behind a shared address, and spreading an attack across addresses does not evade the limit.
