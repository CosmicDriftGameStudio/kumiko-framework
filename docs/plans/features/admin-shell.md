---
status: in-progress
verified: 2026-07-06
next: Full review (screenshots in review/admin-shell/); then close issue when approved
evidence: "kumiko-framework feat/admin-shell 552dc567..30f46c11; kumiko-studio 1c3f190; publicstatus b1e5791"
---

# Admin shell (bundled-feature)

Role-gated **workspaces** + provider nav into owner-feature operator screens.
Screens live in their owner features (`tenant`, `audit`, `jobs`, …); `admin-shell`
only composes workspaces, overview home, and cross-feature nav.

## Mount

```typescript illustration
import { createAdminShellFeature } from "@cosmicdrift/kumiko-bundled-features/admin-shell";
import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { tierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";

await runDevApp({
  features: [
    createAuditFeature(),
    createJobsFeature(),
    tierEngineFeature,
    createAdminShellFeature({
      workspaceIds: { tenant: "tenant-admin", platform: "platform" },
      includeTierAdmin: true,
    }),
  ],
  auth: { /* … */ },
});
```

Client: `adminShellClient()` plus owner clients (`tenantClient`, `auditClient`, …).
Sample: `kumiko-framework/samples/apps/admin-console` (port 4177 dev, 4178 E2E).

## Workspaces

| Workspace (default id) | `access` | Nav (first → last) |
|---|---|---|
| `tenant-admin` | `access.admin` (`TenantAdmin`, `Admin`, `SystemAdmin`) | Overview → Members → Audit log |
| `platform` | `access.systemAdmin` | Overview → Tenants → Job runs → Tier admin (optional) |

`createAdminShellFeature({ workspaceIds })` maps URL segments for app conventions
(Studio `d`/`s`, PublicStatus `admin`/`sysadmin`).

**`registerWorkspaces: false`** — app owns `r.workspace()`; admin-shell registers
overview screens + nav QNs only. Wire nav into your workspace arrays and mount
`adminShellClient()` + `tenantClient()`. Studio/PublicStatus use this pattern.

**`useShellUser`:** must pass merged `session.roles` (global + membership) into
`WorkspaceShell.user` — `SystemAdmin` is a global role.

## Operator screens (owner features)

| Feature | Screen | Screen access | Notes |
|---|---|---|---|
| `tenant` | `members` | `access.admin` | Invite/cancel only; closed role allowlist in UI |
| `audit` | `audit-log` | `access.admin` | Tenant-scoped query; platform audit = switch tenant |
| `jobs` | `job-runs`, `job-run-detail` | `SystemAdmin` | Cross-tenant by design |
| `delivery` | `delivery-log` | `access.admin` | Tenant-scoped |
| `feature-toggles` | `toggle-admin` | `SystemAdmin` | Platform nav only |
| `compliance-profiles` | `profile-picker` | `access.admin` | `crossTenantOverrideDenied` on write |
| `cap-counter` | `cap-list` | `SystemAdmin` | `entityList` |

## Overview home (query allowlist)

Attention cards only — no KPI charts. Client helper `overviewQuery()` enforces
hard-coded allowlists (`overview-allowlist.ts`).

| Workspace | Allowed queries |
|---|---|
| Tenant | `tenant:query:invitations`, `tenant:query:members`, `config:query:readiness`, `cap-counter:query:get-counter` |
| Platform | `tenant:query:list`, `jobs:query:list` (failed filter in UI) |

Tenant overview must **not** call platform QNs; guarded by unit + integration +
E2E (`admin-console/e2e/role-gating.spec.ts`).

## Security matrix (handler vs screen)

Rule: every query/write the UI calls must have **handler access ⊆ screen access**
(or screen tighter). Escalation class: reserved membership roles, `tenantIdOverride`,
global tables with tenant-admin access.

| Surface | Handler / query | Roles | Tenant-scoped? |
|---|---|---|---|
| Members UI | `tenant:query:members`, `tenant:query:invitations` | `access.admin` | yes |
| Members UI | `auth-email-password:write:invite-create`, `tenant:write:cancel-invitation` | `access.admin` | yes |
| Members UI | `tenant:write:update-member-roles` | `SystemAdmin` only | — **not exposed in UI** |
| Audit log | `audit:query:list` | `access.admin` | yes (active tenant) |
| Job runs | `jobs:query:list`, `jobs:query:details` | `SystemAdmin` | no |
| Toggle admin | `feature-toggles:query:list`, `registered`, `write:set` | `SystemAdmin` | global table |
| Delivery log | `delivery:query:log` | `access.admin` | yes |
| Compliance | `compliance-profiles:write:set-profile` | `access.admin` | override guarded |

**Invite role picker:** closed allowlist `User` / `Admin` / `Editor` — never free
text; server rejects `FORBIDDEN_ROLES` via `findForbiddenMembershipRole`.

## Test obligations

| Layer | What |
|---|---|
| `*-security.integration.test.ts` | `setupTestStack` + `stack.http`, 403 matrix, tenant isolation, reserved roles |
| Boot | Screen access vs handler roles |
| E2E | `admin-console/e2e/role-gating.spec.ts` — workspace visibility, overview, API 403 |

No mocks (`createTestDispatcher`, `jest.mock`) for security proofs.

## PublicStatus wiring (app-owned workspaces)

PublicStatus uses `registerWorkspaces: false` and owns `admin` + `sysadmin`
workspaces in `publicstatus/feature.ts`. The visual workspace was removed;
content/legal provider navs (`publicstatus:nav:content`, `publicstatus:nav:legal`)
live under **sysadmin** alongside ops screens.

| Workspace | Nav highlights |
|---|---|
| `admin` (tenant-admin) | Overview, incidents, monitors, members, audit log, account/settings |
| `sysadmin` (platform) | Overview, tenants, users, job runs, audit log, DSGVO exports, content, legal, tier admin |

Mount: `auditClient`, `jobsClient`, `tierEngineClient`, `textContentClient`,
`legalPagesClient` in `publicstatus/src/admin/mount.tsx`. Stripe/SMTP mask
labels ship via feature `r.translations()` (no client override needed).

## Open (Phase D)

- [x] Studio: `platform-shell` → `tenant:screen:members`, workspaces `d`/`s`
- [x] PublicStatus: `admin` / `sysadmin` workspace ids, seed role drift check

