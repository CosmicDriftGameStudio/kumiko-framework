# user-data-rights

DSGVO-compliant in 5 LOC: `r.useExtension(EXT_USER_DATA, ...)` hängt eine
beliebige Domain-Entity an Forget-Cron + Export-ZIP + Magic-Link-Pipeline.
App-Author schreibt nur die zwei Hooks pro Entity — der Rest passiert
automatisch.

## Was es zeigt

Eine minimale Notes-Domain, die DSGVO Art. 15+17+20 vollständig integriert,
ohne Forget-Logik selbst zu schreiben:

```ts
defineFeature("notes", (r) => {
  r.requires("user-data-rights");
  r.entity("note", noteEntity);

  r.useExtension(EXT_USER_DATA, "note", {
    export: async (ctx) => ({
      entity: "note",
      rows: await ctx.db.select().from(notesTable)
        .where(and(eq(notesTable.tenantId, ctx.tenantId),
                   eq(notesTable.authorId, ctx.userId))),
    }),
    delete: async (ctx, strategy) => {
      const where = and(eq(notesTable.tenantId, ctx.tenantId),
                        eq(notesTable.authorId, ctx.userId));
      if (strategy === "anonymize") {
        await ctx.db.update(notesTable).set({ authorId: null }).where(where);
      } else {
        await ctx.db.delete(notesTable).where(where);
      }
    },
  });
});
```

## Was automatisch wird

| Artikel | Was läuft | Wer triggert |
|---------|-----------|---------------|
| Art. 15 + 20 | Notes-Snippet landet im Export-ZIP, Magic-Link an User-Email | `runUserExport` (Cron via `request-export`-Endpoint) |
| Art. 17 | Notes werden gelöscht oder anonymisiert nach Grace-Period | `runForgetCleanup` (Cron) |
| Art. 18 | Restriction blockt User-Login solange aktiv | `auth-middleware` (alle Login-Pfade) |
| Operator | Brute-Force-Detection auf Magic-Link-Endpoint | Edge-Rate-Limit + 90d Audit-Log |

## Strategy-aware delete

`retention.policyFor("note")` resolved pro Entity die Strategy:

| Profile | Strategy | Effekt |
|---------|----------|--------|
| `eu-dsgvo` (Default) | `delete` | Notes hard-delete |
| `de-hr-dsgvo-hgb` | `anonymize` für HR-Entities | `authorId=null`, Row bleibt — wichtig für Multi-User-Refs (Chat, Comment-Threads) |

Der Test-File pinst beide Pfade.

## Demo-Szenario im Test

```bash
bun test
```

`src/__tests__/feature.integration.ts` beweist Schritt für Schritt:

1. Alice legt 2 Notes an → `runUserExport` returned Bundle mit Note-Snippet
2. Alice triggered Deletion + Grace abgelaufen → `runForgetCleanup` löscht alle Notes
3. Strategy=anonymize → `authorId=null`, Note-Row bleibt mit Title+Body

## Das volle Bild

Recipe = 1 Hook-Pattern, fokussiert auf das Wesentliche.

- Vollständige runnable App: [`samples/apps/user-data-rights-demo`](../../apps/user-data-rights-demo)
- Cross-Data-Matrix-Test (3 Provider gleichzeitig): [`packages/bundled-features/src/user-data-rights/__tests__/cross-data-matrix.integration.ts`](../../../packages/bundled-features/src/user-data-rights/__tests__/cross-data-matrix.integration.ts)
- Operator-Guide für Verarbeitungsverzeichnis + AVV: [`packages/bundled-features/src/user-data-rights/COMPLIANCE.md`](../../../packages/bundled-features/src/user-data-rights/COMPLIANCE.md)

## Dependencies

```ts
// In deiner App's run-config:
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";

export const features = [
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(), // Default-Hooks für user + fileRef
  notesFeature,                            // deine Domain
];
```
