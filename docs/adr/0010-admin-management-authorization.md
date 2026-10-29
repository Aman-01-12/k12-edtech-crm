# 0010. Every admin can manage admins

Status: accepted

## Context

Admin account management was added to scope: list accounts, create one, deactivate one. That raises an authorization question the core feature set did not, because creating an account is a privileged action in a way that reading an inquiry is not.

There is no role column ([0007](0007-single-principal-authorization.md)), so there is no existing mechanism to say that only some admins may do this.

## Decision

Any authenticated admin can list, create and deactivate admin accounts.

This is a deliberate choice for a small internal team, not an oversight, which is why it has a record.

## Alternatives considered

**Introduce a `superadmin` role for account management.**
The conventional answer. Rejected because it reverses [0007](0007-single-principal-authorization.md) to serve one feature, and it introduces the question that privilege tiers always introduce: who is the first superadmin, what happens when the only one is deactivated, and can a superadmin demote another. Those need answers, tests, and UI. For a team of a few staff at one organisation, that is a lot of machinery to express "we all trust each other with the staff list".

**Keep account management out of the API entirely, as a CLI script only.**
This was the original scope decision and it is defensible: provisioning is rare and an operator command is sufficient. Reversed because the wider scope was chosen deliberately, and a dashboard where adding a colleague requires a developer is a worse product.

**Allow creation but not deactivation through the API.**
Rejected as the worst of both: it still has no privilege model, and it leaves the genuinely urgent action, revoking access for someone who has left, as the one that needs a developer.

## Consequences

Any compromised admin session can create another admin account, which is a real escalation path and is stated rather than glossed. It is bounded by three things: every account change writes an `admin_account_changed` security event naming the acting admin and the target, that log is append-only and enforced by a trigger rather than by a revoked privilege, and the blast radius of a compromised admin session already includes every inquiry in the table.

Two guards exist because they prevent accidents rather than attacks. An admin cannot deactivate their own account, so the last administrator cannot lock everyone out with one click. Deactivation revokes every refresh token for that account inside the same transaction as the soft delete, so access stops immediately instead of at the next token expiry.

Adding a privilege tier later is a migration, a token claim, and a middleware argument. The security event log means the history of who changed what survives that change.
