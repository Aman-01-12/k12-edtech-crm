# 0005. Layered rate limiting, sliding window, Postgres-backed

Status: accepted (supersedes an earlier draft of this record)

## Context

Two endpoints need protection for different reasons.

The public submission endpoint is unauthenticated and world-writable, which makes it the spam and resource-exhaustion surface. Sign-in accepts credentials, which makes it the brute-force surface.

Separately, a submission that times out has to be retriable without creating a duplicate, because the client cannot distinguish a lost request from a lost response.

An earlier draft of this record specified a fixed-window counter keyed on the client IP for submission and on the email for sign-in. That design had three defects, and this record exists mainly to name them.

## The three defects

**1. A fixed window admits twice the limit.** An attacker sends the full allowance in the last instant of one window and the full allowance again in the first instant of the next. For a 5-per-minute limit that is 10 requests in a moment.

**2. Keying on the client IP punishes the wrong people.** Carrier-grade NAT puts many unrelated subscribers behind one public address. Cloudflare's own measurement work describes a single IPv4 address representing hundreds or thousands of users and calls out the resulting collateral damage as falling hardest on users in developing regions. Indian mobile networks are heavy CGNAT users, and Indian parents and students on mobile are exactly this product's audience. A tight per-IP limit on the public form would block an entire school to stop one abuser.

The same key fails in the opposite direction on IPv6, where a residential or mobile customer is typically delegated a whole /64. Limiting per full address is free to evade: pick another address from your own prefix.

**3. Keying sign-in on the email alone misses credential stuffing.** The two attack shapes evade opposite keys. A targeted brute force hits one account from many addresses, which only an account key catches. Credential stuffing hits many accounts with a few attempts each, which only a network key catches. OWASP API2:2023 treats brute force against a single account without a limit as a vulnerability, and the per-account key alone leaves the stuffing case wide open.

## Decision

**Algorithm: sliding window counter.** Estimated hits are `previous * (1 - elapsed fraction) + current`, rounded up. This removes the boundary burst for one extra row read in the same query and the same O(1) storage per subject, so there is no reason to keep the weaker algorithm.

**Keying: the most specific identity available.**

| Endpoint | Key | Why |
|---|---|---|
| Public submission | network (IPv4, or IPv6 /64) | nothing else exists; generous, and not relied on alone |
| Sign-in | account **and** network, both enforced | the two attack shapes evade opposite keys |
| Token refresh | network | pre-authentication by definition |
| CSV export | authenticated admin id | the account is accountable; an address is not |

IPv6 is collapsed to the /64 so the key is as hard to rotate as an IPv4 address.

Sign-in limiters set `skipSuccessfulRequests`, which makes them a **failed-attempt** budget rather than a sign-in budget. A user who mistypes once and then succeeds is not penalised; an attacker guessing wrongly is.

**The public form does not rely on the network key alone**, because that key cannot be made trustworthy. A honeypot field catches naive automation independently of the address, and the idempotency key removes the retry-storm case.

**Idempotency: a partial unique index** on `inquiries(idempotency_key) where idempotency_key is not null`. A replayed key raises a unique violation, which the repository turns into re-reading and returning the original row.

**Storage: Postgres**, in a `rate_limit_hits` table declared in `schema.sql`, keyed `(bucket_key, window_start)`.

## Alternatives considered

**The default in-memory store.** Wrong the moment there is more than one instance, which for a serverless deployment is always. The advertised limit would scale with the number of warm instances, which is exactly backwards.

**`@acpr/rate-limit-postgresql`.** Considered seriously, then rejected: it pins its own copy of `pg` and runs its own migrations, creating tables outside `schema.sql`, which breaks the single-schema-file deliverable. Its issue tracker also carries migration-failure reports. A store of this size against a table we already declare is less code and less risk.

**Sliding window log.** The most accurate option: one row per request, exact. Rejected on cost. It turns an O(1)-per-subject counter into O(requests), on the unauthenticated endpoint an attacker controls the row count of, which converts a rate-limit table into a storage-exhaustion vector.

**Token bucket or GCRA.** Both good, and token bucket is the better choice when controlled bursts are desirable. Rejected because bursts are not desirable on either endpoint here: nobody legitimately submits five inquiries in two seconds, and nobody legitimately makes ten sign-in attempts at once. Leaky-bucket shaping is likewise solving a traffic-smoothing problem this application does not have.

**A captcha on the public form.** The strongest anti-automation layer and the one with the highest cost: effort for every legitimate user, a third-party dependency, and a privacy question, on a form whose entire purpose is that a stranger can reach the organisation easily. Held as the escalation if abuse actually appears, with the honeypot as the zero-cost layer meanwhile.

**Account lockout rather than a limit.** NIST SP 800-63B-4 permits disabling an authenticator after at most 100 consecutive failures, and NCSC suggests 5 to 10 where lockout is used. Rejected because a lockout keyed on email is itself a denial-of-service: anyone can lock any admin out by failing ten times against their address. A self-healing window gives the same brute-force resistance without handing an attacker that lever.

## Consequences

The limit holds across instances, because the counter lives in the one place every instance shares.

**Rate limiting fails open.** If the store is unreachable the request is allowed and a warning is logged. This is deliberate and worth stating plainly: a database blip must not lock every admin out of signing in, and an attacker who can break the counter can already break the application. The same trade would be wrong for an authorization check, which fails closed.

The sliding window's weighting assumes the previous window's requests were spread evenly. That is an approximation, wrong in the attacker's favour by less than one window's worth, which is the price of not keeping a log.

The public form's limit is generous by design, so it stops scripted hammering rather than policing how many questions one household may ask. That is the correct trade given who shares an address, and it is why the honeypot and the idempotency key exist rather than a tighter number.

Expired windows accumulate and are swept by age; the table is indexed on `window_start` for that.

**What this does not defend against.** A distributed botnet with one request per address defeats every network key, and a well-built bot ignores the honeypot. At that point the answer is an edge WAF or a captcha, not a bigger number in this table. Stating the boundary is more useful than implying the layers are complete.
