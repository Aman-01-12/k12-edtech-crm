# 0011. Database TLS verified by default

Status: accepted

## Context

The first draft of the connection pool contained this:

```ts
ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false };
```

That is the line almost every Supabase and Node tutorial contains, and it is wrong.

`rejectUnauthorized: false` keeps the connection encrypted but stops checking **which server answered**. Anything able to intercept the connection can present its own certificate, terminate the TLS, and read every admin password and every inquiry that crosses it. Encryption without authentication defends against a passive listener and not against an active one.

It is there because Supabase signs its Postgres certificate with its own CA, which is not in Node's default trust store, so strict verification fails with `SELF_SIGNED_CERT_IN_CHAIN` until you supply the CA. Turning verification off makes the error go away, which is why it spreads.

## Decision

Secure by default, with an explicit and visible way out.

1. A local database gets no TLS at all. There is nothing to authenticate across a loopback interface.
2. If `DATABASE_CA_CERT` is set, verify against it with `rejectUnauthorized: true`. This is the correct configuration for Supabase; the certificate is downloadable from the project's database settings. The supplied CA is **added** to Node's bundled roots rather than replacing them, because Node's `ca` option is a replacement: a private CA on its own would reject a provider whose certificate happens to chain to a public one, so setting the variable would turn a working connection into a broken one.
3. Otherwise verify against the system trust store. If the provider's certificate does not chain to a public CA this fails loudly at connect time, which is the right outcome.
4. `DATABASE_SSL_NO_VERIFY=true` skips verification. It must be set deliberately, and it logs a warning naming the host on every startup.

## Alternatives considered

**Keep `rejectUnauthorized: false`.**
Rejected. It is a security control that appears present and does nothing, which is worse than its absence because it stops anyone looking again.

**Bundle the CA certificate in the repository.**
Tempting, because it makes verification work with no configuration. Rejected: the certificate is deployment-specific, it expires, and a stale committed CA fails in a way that looks like an outage. An environment variable is the same mechanism every other deployment secret uses.

**Fail hard when no CA is configured and the host is remote.**
The strictest option, and rejected as the wrong default for a submission someone else has to deploy. It would turn a missing optional variable into a service that refuses to start, with an error pointing at TLS rather than at the variable. The escape hatch exists so that outcome is a deliberate choice rather than a wall, and it is loud enough not to be chosen by accident.

## Consequences

The default configuration authenticates the database server. The insecure path exists, requires an explicit variable, and announces itself in the logs every time the process starts.

The README documents downloading the CA certificate, and `.env.example` explains both variables and which one is correct.

This is also the general rule for this codebase: a control that is easy to satisfy incorrectly should fail loudly rather than degrade quietly.
