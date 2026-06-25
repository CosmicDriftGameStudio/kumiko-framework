# user-data-rights

GDPR-compliant domain wiring in ~5 lines: `r.useExtension(EXT_USER_DATA, …)`
hooks any entity into the forget cron, export ZIP, and magic-link pipeline.
You write two hooks per entity — the framework runs the rest.

## What it shows

A minimal notes domain with GDPR Art. 15+17+20 integrated without hand-written
forget logic:

```ts illustration
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

## What runs automatically

| Article | What happens | Trigger |
|---|---|---|
| Art. 15 + 20 | Notes snippet in export ZIP + magic-link email | `runUserExport` (via `request-export`) |
| Art. 17 | Notes deleted or anonymized after grace | `runForgetCleanup` cron |
| Art. 18 | Restriction blocks login while active | Auth middleware |
| Operator | Brute-force detection on magic-link endpoint | Edge rate-limit + audit log |

## Strategy-aware delete

`retention.policyFor("note")` resolves per entity:

| Profile | Strategy | Effect |
|---|---|---|
| `eu-dsgvo` (default) | `delete` | Notes hard-deleted |
| `de-hr-dsgvo-hgb` | `anonymize` for HR entities | `authorId=null`, row kept for multi-user refs |

The integration test pins both paths.

## Flow

1. User creates notes → rows stored with `authorId`.
2. `request-export` queues job → `runUserExport` bundles user + note rows.
3. `request-deletion` → grace period from compliance profile.
4. `runForgetCleanup` calls your `delete` hook with resolved strategy.

## Tests

```bash
bun test src/__tests__/feature.integration.test.ts
```

Step-by-step proof:

1. Alice creates 2 notes → export bundle includes note snippet
2. Deletion + expired grace → `runForgetCleanup` removes all notes
3. Strategy `anonymize` → `authorId=null`, title/body remain

## Full app vs this recipe

| | This recipe | [user-data-rights-demo](/en/samples/apps-user-data-rights-demo/) |
|---|---|---|
| Scope | One hook pattern | Runnable app + todos + files |
| Boot | Integration test only | `bun dev` on port 4291 |

## Dependencies

```ts illustration
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";

export const features = [
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  notesFeature,
];
```
