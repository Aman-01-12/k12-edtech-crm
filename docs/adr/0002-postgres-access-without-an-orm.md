# 0002. Hand-written SQL over `pg`, not an ORM

Status: accepted

## Context

The brief permits `pg`, Prisma or Sequelize, and separately requires a `schema.sql` containing the table definitions.

That second requirement is what decides this.

## Decision

Use `pg` with hand-written parameterized SQL, behind a repository layer that is the only place SQL exists.

## Alternatives considered

**Prisma.**
Excellent developer experience and genuinely safe query construction. It also wants to own the schema through `schema.prisma` and its own migration history. The deliverable is a `schema.sql`, so the schema would then be defined twice, in two languages, with nothing keeping them in agreement. A reviewer finding a `schema.prisma` and a `schema.sql` in one repository is right to ask which one is true.

Prisma also pushes toward `OFFSET` pagination and makes keyset pagination awkward, and the index strategy this dashboard needs is easier to express and justify in DDL than in schema annotations.

**Sequelize.**
Same duplicate-schema problem, an older API surface, and heavier runtime reflection for no benefit at this size.

**A query builder such as Kysely.**
Closer to the right answer: typed, no schema ownership. Rejected because its types are generated from the schema, which reintroduces a generation step, and because the queries here are few and the interesting ones (row-wise keyset comparison, conditional aggregation, `ILIKE` with an explicit `ESCAPE`) are clearer written directly.

## Consequences

`schema.sql` is unambiguously the single source of truth, which is exactly what the brief asks for.

Query plans are inspectable because the queries are the thing that was written, not a thing that was generated. The index strategy in `schema.sql` can name the query each index serves.

The cost is that safety is a discipline rather than a type system guarantee: every query must be parameterized by hand. That is mitigated structurally, not by care alone. SQL lives only in `*.repository.ts`, a lint rule stops any other layer importing those modules, and the security regression suite includes a payload of SQL metacharacters that must come back stored verbatim.

Row-to-domain mapping is also manual. Repositories name every column they select, which is the same discipline that stops a new column silently widening an API response.
