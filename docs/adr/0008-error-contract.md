# 0008. A house error shape, not RFC 9457

Status: accepted

## Context

Every endpoint needs one error shape. There is a standard for this: RFC 9457, Problem Details for HTTP APIs, which obsoletes RFC 7807 and specifies `type`, `title`, `status`, `detail` and `instance` under `application/problem+json`.

There is also an existing house contract in the system this project's standards come from:

```json
{ "error": "Human readable message", "code": "MACHINE_READABLE_CODE", "requestId": "uuid" }
```

## Decision

Use the house contract, with an optional `details` object carrying field-level validation messages.

One middleware writes every error response, so the shape cannot vary by route.

## Alternatives considered

**RFC 9457.**
The recognisable, standards-compliant answer, and a reviewer would accept it without comment. Rejected on two grounds.

The first is consistency. The project's authoritative standards document specifies the house shape as a hard rule, and a submission that quietly departs from the conventions it claims to follow is worse than one that follows a slightly less fashionable convention.

The second is that `type` as a URI reference is the part of RFC 9457 that earns its keep, and it earns it in a federated setting where clients encounter problem types from services they do not control. Here one client talks to one API. A `code` enum the client switches on does the same job without requiring a URI namespace nobody will dereference.

**Both: house fields plus the RFC's.**
Rejected. Two parallel representations of the same failure means two things to keep in agreement, and a client author has to guess which is authoritative.

**Bare HTTP status codes with no body.**
Rejected. The client has to distinguish an expired access token, which should trigger a silent refresh and replay, from an invalid one, which must force sign-out. Both are 401, so the status alone cannot carry the decision.

## Consequences

`code` is the client's branch point and is treated as a published API: it does not change once released. `TOKEN_EXPIRED` and `TOKEN_INVALID` are deliberately distinct for the reason above.

`requestId` appears on every error and tags every log line for that request, which is what turns a user's report into something traceable. The full internal cause is logged against that id and never sent to the client, so no response carries a stack trace, a driver message, SQL, or an internal hostname.

`details` is present only on a validation failure and describes the caller's own input, so it discloses nothing about the server.

If this API ever becomes one of several a client talks to, migrating to RFC 9457 is a change in one middleware function, because nothing else writes an error.
