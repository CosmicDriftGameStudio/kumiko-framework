# template-resolver

Strukturierter Content-Storage mit Tenant-Override-Hierarchie, Locale-Fallback und Resource-Linking via `file-foundation`. Eine Entity (`template-resource`) für alle Content-Arten — Render-Templates (`mail-html`, `document-pdf`, `notification`, `image-snapshot`), Markdown-Textblöcke (`text-block`, ex `text-content`-Feature) und AI-Prompts (`ai-prompt`).

**Plan-Doc:** [`kumiko-platform/docs/plans/features/template-resolver.md`](../../../../../../kumiko-platform/docs/plans/features/template-resolver.md)

**Status (2026-05-19):** 45 Integration-Tests grün, typecheck grün, self+advisor-reviewed. Implementierungs-Erkenntnisse im Plan-Doc.

## Mount

```typescript
// App-Bootstrap
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";

const features = [
  createTemplateResolverFeature(),
  // ... weitere Features
];

const app = createKumikoApp({
  features,
  extraContext: ({ db }) => ({
    templateResolver: createTemplateResolverApi(db),
  }),
});
```

## Konsumtion (in Feature-Handlern)

```typescript
import { requireTemplateResolver } from "@cosmicdrift/kumiko-bundled-features/template-resolver";

async function someHandler(ctx) {
  const templateResolver = requireTemplateResolver(ctx, "someHandler");
  const template = await templateResolver.resolveTemplate({
    tenantId: ctx.user.tenantId,
    slug: "nka-versand",
    kind: "mail-html",
    locale: "de",
  });
  // template.content + template.variableSchema + template.linkedResources verwenden
  // ...
}
```

## Resolver-Reihenfolge (4-Stufen-Fallback)

1. `tenantId` + requested locale
2. `SYSTEM_TENANT_ID` + requested locale
3. `tenantId` + `FALLBACK_LOCALE` (default "de")
4. `SYSTEM_TENANT_ID` + `FALLBACK_LOCALE`

Wenn nichts gefunden → `TemplateNotFoundError`.

## Boot-Seeding (System-Templates)

```typescript
import { seedSystemTemplate } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";

// runProdApp seeds — idempotent, default skip if slug exists
await seedSystemTemplate(db, {
  slug: "welcome-email",
  kind: "notification",
  locale: "de",
  content: JSON.stringify({ header: "Willkommen", sections: [{ text: "…" }] }),
  contentFormat: "plain",
});
```

`ifExists: "update"` für autoritative Re-Seeds (z.B. nach Template-Content-Release).

## Admin-Workflows (Write-Handlers + Queries)

| Handler | QN | Wer | Was |
|---|---|---|---|
| `TemplateResolverHandlers.upsertSystem` | `template-resolver:write:upsert-system` | SystemAdmin | Erstellt/Updated System-Default-Templates (`SYSTEM_TENANT_ID`, scope='system', status='active') |
| `TemplateResolverHandlers.upsertTenant` | `template-resolver:write:upsert-tenant` | TenantAdmin (eigener Tenant) + SystemAdmin via `tenantIdOverride` | Erstellt/Updated Tenant-Overrides (scope='tenant'), default-status='draft' |
| `TemplateResolverHandlers.publish` | `template-resolver:write:publish` | TenantAdmin (eigener Tenant) | Setzt status='active' |
| `TemplateResolverHandlers.archive` | `template-resolver:write:archive` | TenantAdmin (eigener Tenant) | Setzt status='archived' (Resolver ignoriert es danach) |
| `TemplateResolverQueries.findById` | `template-resolver:query:find-by-id` | TenantAdmin + User (eigener Tenant + system-templates sichtbar) | Raw-Lookup für Edit-UI |
| `TemplateResolverQueries.list` | `template-resolver:query:list` | gleich | Filter nach kind/locale/status, optional includeSystem |

**SystemAdmin-Cross-Tenant für publish/archive/findById:** deferred (Task 8) — `upsertTenant` hat `tenantIdOverride` bereits; publish/archive brauchen das erst wenn ein Sysadmin-Panel fremde Tenant-Templates kuratiert. `ctx.db` ist tenant-scoped, fremde IDs → NotFound ohne Override.

## Status-Lifecycle

```
upsertSystem  ──┐
                ├──► status: "active" (System-Default sofort aktiv)
upsertTenant  ──┴──► status: "draft" (Default) | "active" (explizit)

publish ───────► status: "active"
archive ───────► status: "archived"
```

Resolver returnt **nur** Templates mit `status: "active"`. draft/archived werden ignoriert.

## Consumer Conformance

Plugins and features that call `resolveTemplate` can verify correct edge-case handling:

```typescript
import { describe, test } from "bun:test";
import { runTemplateConsumerConformance } from "@cosmicdrift/kumiko-bundled-features/template-resolver/testing";

describe("my-mail-renderer :: template-resolver conformance", () => {
  runTemplateConsumerConformance(
    test,
    {
      resolve: (args) => templateResolver.resolveTemplate(args),
      resolveResources: async (template) => resolveLinkedResources(ctx, template),
    },
    { getDb: () => db, tenantId: ctx.user.tenantId },
  );
});
```

The harness checks `TemplateNotFoundError` propagation, locale-fallback, and (when `resolveResources` is provided) missing resource keys.

## Text-Blöcke (`kind: "text-block"`)

Marketing-, FAQ- und Legal-Texte laufen über denselben Store, aber über einen
eigenen Write-Pfad: `set.write` trägt `title` + `folder` (Content-Tree) und
kennt keinen draft-Status — Speichern veröffentlicht.

| Handler | QN | Wer | Was |
|---|---|---|---|
| `TemplateResolverHandlers.set` | `template-resolver:write:set` | TenantAdmin + SystemAdmin (via `tenantIdOverride` auch auf `SYSTEM_TENANT_ID`) | Upsert eines Text-Blocks pro `(tenantId, slug, locale)` |
| `TemplateResolverQueries.bySlug` | `template-resolver:query:by-slug` | anonymous + User + Admins | Ein Text-Block — der Public-Read für Landing-/Legal-Pages |
| `TemplateResolverQueries.byTenant` | `template-resolver:query:by-tenant` | anonymous + User + Admins | Alle Text-Blöcke eines Tenants für den Content-Tree |

Die beiden Queries sind fest auf `kind: "text-block"` verdrahtet: Mail-Templates
und AI-Prompts liegen in derselben Tabelle und dürfen nicht über den anonymen
Pfad rausfallen.

Seed-Helper: `seedTextBlock` / `seedLegalContentFromJson` aus
`@cosmicdrift/kumiko-bundled-features/template-resolver/seeding`.

Content-Tree + Editor (Desktop-Web):

```typescript
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";

createKumikoApp({
  clientFeatures: [textBlocksClient({ navId: "myapp:nav:content", tenantId: SYSTEM_TENANT_ID })],
});
```

## Out-of-Scope

- Rendering (Markdown/MJML → HTML/PDF) — siehe `renderer-foundation`
- Resource-URL-Substitution (signed-URL vs. data-URI) — Caller-Verantwortung je nach kind
- Visual Template-Editor — `designer`-Bundle (geplant)
- A/B-Testing — eigenes Bundle wenn Bedarf real


