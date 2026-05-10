# user-data-rights

DSGVO Art. 15 (Auskunft) + Art. 17 (Löschung) + Art. 18 (Restriction) +
Art. 20 (Portabilität) als Core-Feature.

**Status:** S2 abgeschlossen — alle Endpoints, Hooks, Default-Provider,
Cron-Pipeline, Tests + Sample wired.

## Pattern

Statt jedes Feature seine eigene Forget-/Export-Logik schreibt, hängt
es sich via `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })`
an. user-data-rights orchestriert Export- und Forget-Pipeline:

```ts
defineFeature("tasks", (r) => {
  r.requires("user-data-rights");
  r.useExtension(EXT_USER_DATA, "task", {
    export: async (ctx) => ({
      entity: "task",
      rows: await ctx.db.select().from(tasksTable)
        .where(eq(tasksTable.authorId, ctx.userId)),
    }),
    delete: async (ctx, strategy) => {
      if (strategy === "anonymize") {
        await ctx.db.update(tasksTable).set({ authorId: null })
          .where(eq(tasksTable.authorId, ctx.userId));
      } else {
        await ctx.db.delete(tasksTable)
          .where(eq(tasksTable.authorId, ctx.userId));
      }
    },
  });
});
```

Hook-Signaturen in `framework/src/engine/extensions/user-data.ts`:

- `UserDataExportHook(ctx) => Promise<UserDataExportSnippet | null>`
- `UserDataDeleteHook(ctx, strategy) => Promise<void>`
- `UserDataDeleteStrategy = "delete" | "anonymize"`

## Endpoints

| Article | Handler | Zweck |
|---------|---------|-------|
| Art. 15 | `user-data-rights:query:my-audit-log` | User sieht eigene Framework-Events (account-weit über alle Memberships). Domain-Entities ohne `ctx.appendEvent` erscheinen NICHT — nur im Export-Bundle. |
| Art. 15+20 | `user-data-rights:write:request-export` | Async Job → ZIP mit user-Profil + fileRefs + alle EXT_USER_DATA-Provider-Daten + signed Magic-Link |
| Art. 17 | `user-data-rights:write:request-deletion` | Soft-Delete mit Grace-Period, anschließend Cron anonymisiert User + cleant Domain-Entities |
| Art. 17 | `user-data-rights:write:cancel-deletion` | User widerruft seinen Forget-Request während der Grace |
| Art. 18 | `user-data-rights:write:restrict-account` | Auth-Middleware blockt Logins bis Lift |
| Art. 18 | `user-data-rights:write:lift-restriction` | Admin/SystemAdmin hebt Restriction auf |
| Operator | `user-data-rights:query:list-download-attempts` | DPO-Sicht auf invalid Download-Versuche (Brute-Force-Detection, Admin/SystemAdmin only) |

Plus 2 anonyme HTTP-Routes für Export-Download (Magic-Link-Pfad +
session-auth-Pfad), siehe `handlers/download-by-{token,job}.query.ts`.

## Cross-Feature-API

**Exposes:**
- `userDataRights.runExport` — über die public Runner-Exports
  (`runUserExport`, `runForgetCleanup`)
- `userDataRights.runForget`

**Uses:**
- `compliance.forTenant` (Grace-Period aus Profile)
- `retention.policyFor` (blockDelete-Konsultation, anonymize statt delete)
- `sessions.revokeAllForUser` (Restriction killt aktive Sessions)

## Default-Hooks (`user-data-rights-defaults`)

Optional-mountbares Sub-Feature liefert Default-Hooks für
Core-Entities `user` (anonymize: email→`deleted-<id>@anonymized.invalid`,
displayName→`(deleted)`, passwordHash=null) und `fileRef` (delete: row +
storage-binary; anonymize: insertedById=null). App-Author kann es
weglassen wenn er Custom-Hooks registrieren will.

## Audit-Trail

| Tabelle | Zweck | Retention |
|---------|-------|-----------|
| `kumiko_events` | Framework-Event-Store, Quelle für `my-audit-log` | per Domain-Policy |
| `read_export_jobs` | Async Export-Status (queued / done / failed) | per `compliance-profiles` |
| `read_export_download_tokens` | Magic-Link-Hash + TTL + lastUsed-Audit | per `compliance-profiles` (default `exportDownloadTtl`) |
| `read_download_attempts` | Invalid-Download-Versuche für DPO-Brute-Force-Detection | **90d hardDelete** (Entity-Default — schützt vor Disk-Bomb bei aktiven Angriffen) |

## Tests

18 Testdateien, 188 Tests, alle grün:

| Datei | Pinst |
|-------|-------|
| `audit-log.integration.ts` | Cross-User-Isolation, Account-weite Sicht, eventType-Filter, Admin-only operator-query, download-attempt 90d-retention |
| `cross-data-matrix.integration.ts` | 3-Provider-Pipeline (user + fileRef + custom-domain), Cross-Tenant Forget mit user-anonymize, Other-User-Isolation |
| `download.integration.ts` | HTTP-e2e via `r.httpRoute`: Magic-Link, multi-use, expired, failed-job, storage-cleared, cross-tenant-same-user, malicious-filename |
| `request-export.integration.ts` | Idempotency, active-job-constraint, cross-tenant-anyMember-userId-pattern |
| `request-deletion-callback.integration.ts` + `request-cancel-deletion.integration.ts` | Grace + Cancel-Pfad + Email-Callback best-effort |
| `restriction-flow.integration.ts` | Status-Flip + Auth-Middleware-Block + Lift |
| `run-{export-jobs,forget-cleanup,user-export}.integration.ts` | Worker-Logic + Idempotency + Email-Callbacks |
| `policy-to-strategy.test.ts` | Retention.strategy → UserDataDeleteStrategy mapping |
| `user-data-rights.integration.ts` | Boot-Smoke + Feature-Meta |
| `token-helpers.test.ts` + `zip-path.test.ts` | Token-Hashing + Path-Traversal-Schutz |
| `export-job-{idempotency,schema}.test.ts` | Active-job-uniqueness + Schema-Constraints |

## Sample

`samples/apps/user-data-rights-demo` — runnable Demo mit todos-Domain,
EXT_USER_DATA-Hook für strategy-aware delete (anonymize → authorId=null,
delete → DROP), 3 living-doc Integration-Tests.
