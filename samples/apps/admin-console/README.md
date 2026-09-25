# Admin Console

Sample app for the bundled admin shell: one Kumiko instance with a
tenant-admin and a platform workspace, both built from owner-feature
screens, and role gating that decides which workspace a signed-in user
sees.

**With auth**: email/password login, three seeded users with different
roles. For an auth-free sample, see `samples/apps/marketing-demo/`.

## Run

```bash
bun kumiko dev                          # Postgres + Redis
cd samples/apps/admin-console && bun dev
# → http://localhost:4177
```

Port 4177 is hardcoded in the `dev` script. The server reads the root
`.env` (`--env-file=../../../.env`).

### Demo users

All three log into the dev tenant "Admin Console Demo" (tenant key
`demo`). Passwords are in `src/app/auth-constants.ts`.

| Email | Role | Sees |
|---|---|---|
| `sysadmin@admin-console.local` | global `SystemAdmin`, tenant `Admin` | tenant-admin and platform workspaces |
| `tenant-admin@admin-console.local` | tenant `TenantAdmin` | tenant-admin workspace only |
| `regular@admin-console.local` | tenant `User` | no admin workspace |

The SystemAdmin comes from the `auth.admin` bootstrap in
`src/app/server.ts`; the other two are created by `seedRoleUsers` in
`src/app/seed-users.ts`.

## What's inside

### Mounted features

`src/run-config.ts` lists the server features: `localeDe`, `secrets`,
`audit`, `delivery`, `jobs`, `tier-engine`, `admin-shell` and a small
`home` feature. The client (`src/app/client.tsx`) adds the matching web
parts: email/password login, admin shell, tenant, audit, jobs and tier
engine.

### Workspaces

- `/tenant-admin/`: tenant overview dashboard, members (with invite),
  audit log
- `/platform/`: platform overview dashboard, only for `SystemAdmin`
- The workspace switcher only offers the workspaces the user's roles
  allow

### Home fallback screen

Every admin-shell screen is role gated, but `createKumikoApp` needs an
open default `screenQn`. The `home` feature registers one dormant custom
screen without `access.roles` (`home:screen:home`). A signed-in user
without any admin role lands there and reads "No workspace available
for your account."

### Shell

`src/app/shell.tsx` wraps `WorkspaceShell` with a brand tile and the
default topbar actions (light/dark toggle via lucide icons).

## E2E tests

```bash
cd samples/apps/admin-console
bun x playwright test --config=playwright.config.ts   # server on 4183
```

- `e2e/role-gating.spec.ts`: TenantAdmin lands on the tenant overview
  and never sees the platform tab; the invite role picker offers only
  User, Editor and Admin; the API answers `tenant:list` for a
  TenantAdmin with 403. SystemAdmin sees both workspaces and can switch
  to the platform overview. A regular user sees no workspace tabs.
- `e2e/audit-log-toolbar.spec.ts`: on a narrow viewport the date range
  facet of the audit log toolbar wraps below the search input; on a wide
  viewport both stay on one line.

The CI e2e job runs this config together with the other sample apps.

## What's NOT in here

- Custom business entities (see `apps/marketing-demo/`)
- Config keys and the settings hub (see `apps/config-demo/`)
- Every bundled feature at once (see `apps/use-all-bundled/`)
