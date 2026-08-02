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
| `TemplateResolverHandlers.set` | `template-resolver:write:set` | TenantAdmin + SystemAdmin (via `tenantIdOverride` auch auf `SYSTEM_TENANT_ID`) | Upsert einer Ressource pro `(tenantId, slug, kind, locale)` |
| `TemplateResolverQueries.bySlug` | `template-resolver:query:by-slug` | anonymous + User + Admins | Ein Text-Block — der Public-Read für Landing-/Legal-Pages |
| `TemplateResolverQueries.byTenant` | `template-resolver:query:by-tenant` | anonymous + User + Admins | Alle Text-Blöcke eines Tenants für den Content-Tree |
| `TemplateResolverQueries.collectionItem` | `template-resolver:query:collection-item` | TenantAdmin + SystemAdmin | Eine Ressource beliebigen Kinds |
| `TemplateResolverQueries.collectionList` | `template-resolver:query:collection-list` | TenantAdmin + SystemAdmin | Alle Ressourcen eines Kinds für den Collection-Tree |

Die beiden Public-Queries sind fest auf `kind: "text-block"` verdrahtet und
nehmen **keinen** kind-Parameter. Mail-Templates und AI-Prompts liegen in
derselben Tabelle und laufen deshalb über das eigene Handler-Paar
`collection-*`, das per `access` admin-only ist. Zwei Handler statt eines mit
kind-Parameter: so kann ein neuer kind nicht versehentlich öffentlich lesbar
werden, und die Regel steht deklarativ am Handler statt in einem Zweig im
Handler-Body.

`set` braucht diesen Split nicht — der Handler ist ohnehin admin-only und nimmt
`kind` direkt.

Seed-Helper: `seedTextBlock` / `seedLegalContentFromJson` aus
`@cosmicdrift/kumiko-bundled-features/template-resolver/seeding`.

Content-Tree + Editor (Desktop-Web):

```typescript
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";

createKumikoApp({
  clientFeatures: [textBlocksClient({ navId: "myapp:nav:content", tenantId: SYSTEM_TENANT_ID })],
});
```

## Content-Collections (`r.contentCollection`)

Eine Sammlung erscheint dort in der Nav, wo sie fachlich hingehört — statt alles
in einen zentralen "Content"-Bereich zu kippen:

```typescript
export function createMailFeature() {
  return defineFeature("mail", (r) => {
    r.nav({ id: "root", label: "mail:nav.root" });
    r.contentCollection({
      id: "templates",
      kind: "mail-html",
      nav: { label: "mail:nav.templates", parent: "mail:nav:root" },
    });
  });
}
```

Der Registrar legt den Nav-Knoten mit `provider: true` an und gibt dessen QN
zurück. `textBlocksClient()` bedient jede deklarierte Collection automatisch —
ein Folder-Tree pro Collection, gefiltert auf ihren `kind`, inklusive
SSE-Refresh. Die App reicht dafür nichts durch: navId und kind kommen beide aus
dem Schema und können nicht auseinanderlaufen.

`nav.parent` darf auf ein fremdes Feature zeigen. Der Boot-Validator lehnt
dangling Refs ab — eine Collection unter einem nicht gemounteten Feature lässt
den Boot scheitern statt still aus der Sidebar zu verschwinden.

Ein "+" am Knoten braucht ein explizites `nav.createAction` (Ziel ist
üblicherweise `treeHandle.create`); ohne das listet die Collection nur, was
schon existiert. `nav.actions` setzt Hover-Actions auf die Zeile.

Speichern im Collection-Editor läuft über `set` und **veröffentlicht sofort** —
Status `active`, leeres `variableSchema`. Wer eine Draft-Stufe oder ein
Variablen-Schema braucht, nimmt `upsertSystem`/`upsertTenant` + `publish`.

## Out-of-Scope

- Rendering (Markdown/MJML → HTML/PDF) — siehe `renderer-foundation`
- Resource-URL-Substitution (signed-URL vs. data-URI) — Caller-Verantwortung je nach kind
- Visual Template-Editor — `designer`-Bundle (geplant)
- A/B-Testing — eigenes Bundle wenn Bedarf real


