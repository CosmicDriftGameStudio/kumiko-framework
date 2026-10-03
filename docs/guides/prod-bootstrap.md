---
status: reference
verified: 2026-10-03
---

# Passwordless first-run bootstrap in prod

`runBootstrap` provisions a fresh deployment once: it creates the listed
tenants and mails invitations. No password ever lives in env, a secret or the
image. SystemAdmins get their global role only when they accept the
invitation, so a leaked or mistyped address never holds platform access on its
own.

`runProdApp` no longer needs `auth.admin`. Keep it only if you still want the
legacy password seed.

## Entry point

Create `bin/bootstrap.ts` next to `bin/server.ts`. `buildServerBundle` picks it
up and emits `dist-server/bootstrap.js`.

```ts illustration
import { runBootstrap } from "@cosmicdrift/kumiko-server-runtime";
import { appFeatures, authOptions, kmsSlots } from "../src/server-config";

await runBootstrap({
  features: appFeatures,
  kmsSlots,            // same crypto wiring as the API process
  auth: authOptions,   // same block as runProdApp; needs auth.mail + SMTP_HOST or auth.invite
  tenants: [
    {
      id: "8c0e…" as TenantId,
      key: "acme",
      name: "Acme GmbH",
      invites: [{ email: "office@acme.example", role: "TenantAdmin" }],
      // per-tenant config, set as system writes on every run
      config: { "auth-mfa:config:required": "admins" },
    },
  ],
  systemAdmins: [{ email: "ops@example.com", tenantId: "8c0e…" as TenantId, role: "TenantAdmin" }],
  seed: async ({ tenantId, dispatchSystemWrite }) => {
    // runs only in the run that creates the tenant
  },
});
```

Pass the same `features`, `kmsSlots`, `kms`, `blindIndexKey` and `masterKey` as
the API process. Otherwise the job writes rows the API cannot decrypt.

## Running it

Run it as a one-off Kubernetes Job with the API's image, env and secrets. Use
the command `bun dist-server/bootstrap.js`. The process exits on its own and
logs one line per tenant and per invitation, with the email masked.

1. Apply the migrations first. The job refuses to run on schema drift, like the
   worker does.
2. Dry run: set `KUMIKO_DRY_RUN_ENV=boot`. This validates the composed registry
   and env without opening a connection. With `auth.mail`, `SMTP_HOST` must be
   set for the dry run too, because the job refuses to start without an invite
   flow.
3. Run the job, then check that the invitation mails arrived.
4. Delete the job, or keep the manifest for the next run.

## Running it again

The same plan can run again safely:

| State | What happens |
|---|---|
| tenant exists | nothing; the `seed` hook does not run |
| `config` value differs from the stored one (also on an existing tenant) | written, listed as `config: <key>` in the log |
| `config` value already matches | nothing is written |
| invitation pending (link still valid) | `pending`, no mail |
| invitation expired unused | `resent`, a new link goes out |
| invitation accepted, or the user already has access | `active`, no mail |
| invitation cancelled by an admin | `cancelled`, nothing is re-sent |
| a tenant admin re-invited the address without the planned SystemAdmin role | `role-mismatch`, nothing is sent; decide by hand |

`config` is declarative and converges on every run, so a later run also changes
a value you edited in the plan. Keys that only the system may write (for example
`auth-mfa:config:required`) can be set this way and nowhere else. Encrypted keys
are re-encrypted and rewritten on each run, because their stored value cannot be
compared.

A seed that fails after the tenant was created is not retried by a second run.
Fix the data through the app or a migration instead.

To add a tenant or a person later, extend the plan and run the job again.
