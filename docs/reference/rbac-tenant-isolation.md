---
status: reference
verified: 2026-06-24
---

# RBAC & Tenant-Isolation: role origins and the membership-role invariant

How a session's roles are assembled, why platform-global roles must never live
in a tenant membership, and why that invariant needs enforcement at *two*
points — write time **and** read time.

## Context

Kumiko is multi-tenant and event-sourced. Access control is role-based:
`hasAccess(user, rule)` (`engine/access.ts`) checks whether any of
`session.roles` matches the handler's `AccessRule`. The cross-tenant handler
surface (managed-pages, compliance-profiles, text-content, template-resolver,
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
