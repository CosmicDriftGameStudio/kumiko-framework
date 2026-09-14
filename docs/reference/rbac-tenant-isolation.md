---
status: reference
verified: 2026-09-14
---

# RBAC & Tenant-Isolation: role origins and the membership-role invariant

How a session's roles are assembled, why platform-global roles must never live
in a tenant membership, and why that invariant needs enforcement at *two*
points — write time **and** read time.

## Context

Kumiko is multi-tenant and event-sourced. Access control is role-based:
`hasAccess(user, rule)` (`engine/access.ts`) checks whether any of
`session.roles` matches the handler's `AccessRule`. The cross-tenant handler
surface (managed-pages, compliance-profiles, template-resolver,
the user/tenant admin screens) is gated on `SystemAdmin`. The entire isolation
model rests on one assumption: **`SystemAdmin` cannot be obtained
illegitimately.**

A privilege-escalation bug broke exactly that assumption. `invite-create`
accepted an arbitrary `role`, `accept` wrote it 1:1 into the membership, and
login/switch-tenant merged membership roles flat into the session — so a
Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide,
cross-tenant access. (Proven end-to-end before the fix.)

## Decision 1 — roles have two origins; `hasAccess` is origin-blind

| Origin | Stored in | Scope | Example |
|---|---|---|---|
| **Global** | `users.roles` | platform-wide, tenant-independent | `SystemAdmin`, `system` |
| **Membership** | `tenant_memberships.roles` | one tenant only | `Admin`, `Editor`, `User` |

At login the session is `globalRoles ∪ membershipRoles(activeTenant)`; at
switch-tenant the membership portion is recomputed for the target tenant while
global roles persist. `hasAccess` checks the merged set flat — it has **no
notion of where a role came from**. That flatness is intentional (it keeps
authorization a single set-membership test), but it means the *only* thing
keeping a tenant role from acting platform-wide is that platform roles never
appear in a membership.

## Decision 1a — active membership is resolved before roles are assembled

Login, MFA completion and switch-tenant resolve the target membership through
`dispatcher.resolveActiveMembership` before any role merge runs: is the user a
member of the tenant, is the principal not blocked (`principalStatus`
contract, fulfilled by `user`), and is the tenant not in teardown
(`tenantLifecycleStatus` contract, fulfilled by `tenant-lifecycle`; a tenant in
`destroyRequested` is still allowed so its owner can cancel destruction). Only
then does `buildSessionRoles` merge global + membership roles and
`resolveAuthClaims` mint the session.

`ctx.queryAsMember(userId, qn, payload)` reuses this same resolution for
background reads (a hook/job reading as a stored member instead of SYSTEM),
but under a stricter, non-interactive policy: no `destroyRequested`
cancel-window grace, no unknown-principal pass. The resolved `SessionUser`
carries `origin: "member-resolution"`, no `sid`, and is read-only — writes
through it fail closed (`member_resolution_read_only`), and it is never
signed into a JWT.

## Decision 2 — reserved roles are global-only (the invariant)

`{ system, SystemAdmin, all, anonymous }` (derived from the engine access
presets: `access.privileged ∪ access.all ∪ access.anonymous`) are **reserved**
and must never appear in `tenant_memberships.roles`. Bootstrap already honoured
this (`seedAdmin` writes `SystemAdmin` to global `users.roles`, never a
membership); the invariant makes every other path consistent. The canonical set
lives in `engine/membership-roles.ts` (`FORBIDDEN_MEMBERSHIP_ROLES`).

## Decision 3 — enforce at write time AND read time

Command-time validation alone is **not rebuild-safe**, and that is the
load-bearing insight of this document.

- **Write time (prevention):** every membership-role write chokepoint rejects
  reserved roles — `seedTenantMembership` (covers the three invite-accept
  branches plus seeding), `add-member`, `update-member-roles`, and early in
  `invite-create` (`assertAssignableMembershipRoles` /
  `findForbiddenMembershipRole`).

- **Read time (backstop):** `stripForbiddenMembershipRoles` filters the
  membership portion at **every JWT mint that derives roles from a membership** —
  login, switch-tenant, invite-accept-with-login, invite-signup-complete. It
  wraps **only** the membership array, never the merged result, so a legitimate
  `SystemAdmin` in `globalRoles` is never stripped.

Why both: in an event-sourced system a projection rebuild replays stored
`tenant-membership.created` events **through the apply path, not the handler**.
A command-time validator never runs during replay. So a membership row that was
forbidden when it was first written (e.g. a pre-fix exploited event) would be
*resurrected* into `read_tenant_memberships` by a rebuild — a row migration does
not help, because the event itself remains. The read-time strip neutralises such
a resurrected role on the way into the session, without any projection surgery.

> **General principle:** a security invariant on an event-sourced projection
> needs a read-time enforcement point. Command-time validation protects the
> *write*, not the *replay*. Treat every projection as potentially holding a
> pre-invariant value until a read-time check says otherwise.

## Decision 4 — cross-tenant overrides go through one chokepoint

Handlers that accept a `tenantIdOverride` (the deliberate cross-tenant escape
hatch for SystemAdmin tooling) must gate it through `crossTenantOverrideDenied`
(`engine/cross-tenant.ts`), never an inline `roles.includes("SystemAdmin")`.
One helper means the next override handler cannot quietly ship a weaker check.

Write-isolation itself is already strong: the executor derives `tenantId` from
the session, not the payload — so even with a forged role, writes stay scoped
unless the handler explicitly opts into an override.

The `tenantIdOverride` chokepoint above governs handlers on a tenant-scoped
feature. A feature that declares `r.systemScope()` instead loses the
automatic tenant filter entirely; [`ctx.systemDb`](../guides/handler-context-and-embedded-fields.md)
is that pattern's equivalent self-check requirement.

## Decision 5 — one declaration per cross-tenant path

`TenantDb.raw` existed as a silent, unfiltered escape hatch off `ctx.db` until
fw#2860 removed it. Every cross-tenant read/write now goes through
exactly one of the declarations below; framework infrastructure (the
event-store executor, engine steps, jobs, MSP `apply`) gets its connection
injected by the dispatcher, or resolves it through a framework-private
binding that feature code cannot import.

| Declaration | Scope | What it unlocks | Reason required? | When to use |
|---|---|---|---|---|
| `r.systemScope()` + `ctx.systemDb.assertTenantMatch` / `assertRowsTenant` | Feature | A self-check that the acting user's own tenant matches a row/id — no cross-tenant read, just a fail-closed guard | No (a self-check has nothing to justify) | A `r.systemScope()` handler that still needs to prove it isn't drifting outside the acting tenant |
| `ctx.systemDb.acknowledgeCrossTenant(reason)` | Handler/Hook, only inside an `r.systemScope()` feature | A system-mode `TenantDb` — unfiltered reads/writes via the usual `ctx.db`-shaped methods | Yes | A `r.systemScope()` handler/hook that needs the typed `TenantDb` surface (`selectMany`/`insertOne`/…) across tenants |
| `ctx.systemDb.unsafeRaw(reason)` | Handler/Hook, only inside an `r.systemScope()` feature | A raw `DbRunner` — bypasses the `TenantDb` wrapper entirely | Yes | A `r.systemScope()` handler/hook that needs a raw-SQL helper (`countWhere`, `transaction`, …), which no longer accepts a `TenantDb` |
| `escapeHatch: { reason }` on the handler/hook → `ctx.db.unsafeRaw(reason)` | Handler/Hook, tenant-scoped feature | A raw `DbRunner` for that one declared call site | Yes | A tenant-scoped handler/hook with one specific cross-tenant read/write, without lifting the whole feature to `r.systemScope()` |
| `db.global(table)` writes | Write handler only, gated by the same `escapeHatch: { reason }` | Writes to a `tenancy: "global"` table with the tenant filter lifted | Yes | Writing a `tenancy: "global"` table's rows (reads through `db.global(table)` need no escape hatch) |
| Identity-switch `queryAs` / `writeAs` | Call | Runs the call as a different, resolved `SessionUser` — cross-tenant only if that user's own roles allow it | No (gated by the target user's own access, not a reason) | Acting on behalf of a specific other user rather than lifting the tenant filter itself |
| `escapeHatch: { reason }` on the entity-convention handlers (`defineEntity*Handler` / `registerEntityCrud` write/read) | Handler | One convention handler gets a system-mode `TenantDb`; write verbs address the target row's own tenant stream; does NOT grant `unsafeRaw` / `db.global` writes / identity switch | Yes — reported as `acknowledge-cross-tenant` | An operator (e.g. `SystemAdmin`) write/read on one entity-convention handler that must reach rows in any tenant |
| `ctx.queryProjection(qn, { unsafeAllTenants: true })` | Call | Lifts the `tenant_id` filter on that one projection query | No — today ungated beyond the caller's own access (tracked as a follow-up issue) | A query handler that must aggregate a projection across every tenant |
| Jobs, extension hooks, MSP `apply` | Framework-provided | A `DbRunner`/`TenantDb` handed in by construction — there is no `ctx.db.raw` to reach for | N/A | Framework-internal call sites only; feature code never resolves this itself |

`crossTenant: true` on the entity-convention handlers is deprecated: it still
works, but boot now logs a `deprecation:entity-handler-cross-tenant` warning
per handler, and its use is audited the same way as `escapeHatch` (also
`acknowledge-cross-tenant`). It is scheduled for removal in a later breaking
release. Migrate with `scripts/codemod/migrate-cross-tenant.ts`, which
rewrites the call shapes it can derive a handler name and verb from and lists
the rest for manual review.

## Postgres RLS

Decision: no row-level security policy today — the TypeScript boundary (`TenantDb` without `raw`, the declared escape hatches in Decision 5, the boot-time guards, and the audit trail) is the primary isolation line. A GUC-based policy (`app.tenant_id` via `set_config`) only catches a forgotten application-level filter; any code that can already run raw SQL can set that same GUC or a bypass role itself, so it does not stop the actual bypass class this document defends against. It also has real costs: projection rebuild's safety checks would silently lose effect without a dedicated bypass connection, shadow-swap drops and recreates the live table without carrying its policies over, and pool-safe request handling would need a transaction (not just a pooled connection) scoped per query and per event-stream operation to keep the GUC accurate. Revisit this decision if a compliance requirement mandates database-level isolation, if a real cross-tenant incident occurs despite the TypeScript boundary, or if a consumer needs direct SQL access (a BI/reporting role) — in that last case RLS would apply to that separate, narrowly-scoped read role rather than to the application's own connection pool. See the [RLS evaluation](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/rls-evaluation.md) (kumiko-platform#641, private repo) for the full analysis.

## Enforcement

`infra/guards/guard-tenant-escalation.ts` (scans all Kumiko repos):

- **A** — every role-input write handler must have a test asserting a reserved
  role is rejected.
- **B** — every `tenantIdOverride` handler must call `crossTenantOverrideDenied`.
- **C** — every membership-derived JWT mint must call
  `stripForbiddenMembershipRoles`.

## Consequences

- A new JWT-mint path that reads membership roles **must** strip them; the guard
  catches the common shapes, but the rule is the contract.
- `signup-confirm` is intentionally exempt from the strip: its roles come from
  the compile-time `INITIAL_SIGNUP_ROLES` constant, not a membership.
- Apps never re-implement this. The framework owns role assembly; an app only
  mounts the auth/tenant features and configures them.
