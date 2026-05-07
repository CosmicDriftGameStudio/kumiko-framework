# user-data-rights

DSGVO Art. 15 (Auskunft) + Art. 17 (Löschung) + Art. 18 (Restriction) +
Art. 20 (Portabilität) als Core-Feature.

**Status:** S2.U2 Feature-Scaffold (this sprint). Endpoints + Hooks
folgen in S2.U3-U7 + S2.H1+H2.

## Pattern

Statt jedes Feature seine eigene Forget-/Export-Logik schreibt, hängt
es sich via `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })`
an. user-data-rights orchestriert:

```
defineFeature("tasks", (r) => {
  r.requires("user-data-rights");
  r.useExtension(EXT_USER_DATA, "task", {
    export: async (ctx) => ({ entity: "task", rows: [...] }),
    delete: async (ctx, strategy) => { /* delete | anonymize */ },
  });
});
```

Hook-Signaturen (S1.9 Z1) in `framework/src/engine/extensions/user-data.ts`:

- `UserDataExportHook(ctx) => Promise<UserDataExportSnippet | null>`
- `UserDataDeleteHook(ctx, strategy) => Promise<void>`
- `UserDataDeleteStrategy = "delete" | "anonymize"`

## Sprint-Plan

| Sub | Inhalt | Status |
|-----|--------|--------|
| S2.U2 | Feature scaffold + EXT_USER_DATA-Extension-Marker | ✅ this commit |
| S2.U3 | Async Export-Job + ZIP-Bau via files-Storage | pending |
| S2.U4 | Endpoints POST /data-export + GET /data-export/:jobId | pending |
| S2.U5 | Forget-Pfad mit Grace + Cron-Cleanup | pending |
| S2.U6 | Restriction (Art. 18) + Auth-Middleware-Guard | pending |
| S2.U7 | audit-log + data-summary Queries | pending |
| S2.H1 | user-Feature userData-Hook | pending |
| S2.H2 | files-Feature userData-Hook | pending |
| S2.T1 | Cross-Data-Matrix Integration-Tests | pending |
| S2.S1 | Sample showcases/user-data-rights-demo | pending |

## Cross-Feature-API

**exposes (kommen in S2.U3 + S2.U5):**
- `userDataRights.runExport`
- `userDataRights.runForget`

**uses:**
- `compliance.forTenant` (Grace-Period aus Profile, S2.U5)
- `retention.policyFor` (blockDelete-Konsultation, S2.U5 sobald S2.D3 da ist)

## Tests

`__tests__/user-data-rights.integration.ts` — 4 Boot-Smoke-Tests
(Feature lädt im setupTestStack mit 3 required-Features, EXT_USER_DATA
registriert, requires + usesApi verdrahtet). Echtes Hook-Behavior
kommt mit S2.H1+H2.
