# 0001. TypeScript 6, not the newer 7

Status: accepted

## Context

TypeScript 7.0 is published and is the Go-native rewrite of the compiler.
It type-checks the same code roughly an order of magnitude faster, and it is what `npm install typescript` gives you by default.

Choosing it looks obviously correct, and it is not.

TypeScript 7 ships no stable compiler API.
`typescript-eslint` depends on that API to do type-aware linting, so it refuses to install alongside TypeScript 7: its published peer range is `>=4.8.4 <6.1.0`, and npm fails the install outright.
The maintainers closed the TypeScript 7 support request as not planned, because there is no API for them to target yet, and ESLint's own core work is blocked behind the same thing.

## Decision

Pin TypeScript **6.0.3**, the newest release `typescript-eslint` accepts.

## Alternatives considered

**TypeScript 7.0.2 with type-aware linting dropped.**
The compiler would be faster and the version number newer, and the project would lose the rules that catch a floating promise, a misused promise in an Express handler, and an unsafe `any` flowing across a boundary. On a project whose whole premise is that failure paths are handled explicitly, those are the rules that matter most.

**TypeScript 7 for the build, TypeScript 6 installed alongside for the linter.**
Rejected: two compilers in one tree means the version that type-checks is not the version that lints, so a disagreement between them becomes a silent gap rather than an error.

**TypeScript 5.9.3.**
Safe, and needlessly behind. 6.0.3 is supported by the lint gate and is the documented bridge release to 7.

## Consequences

Type-checking is slower than it could be. On a codebase this size that is unmeasurable.

A working lint gate is worth more than a faster compiler. The gate is what makes "every failure path is handled" a mechanical claim instead of an assertion.

Revisit when `typescript-eslint` ships TypeScript 7 support. The upgrade should be a version bump; TypeScript 6 exists specifically to make that true.
