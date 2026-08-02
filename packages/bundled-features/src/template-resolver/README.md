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
| `<collection>-list` / `-item` / `-set` | `template-resolver:query:<id>-list` … | wie deklariert | Pro Content-Collection, siehe unten |

Die beiden Public-Queries sind fest auf `kind: "text-block"` verdrahtet und
nehmen **keinen** kind-Parameter. Mail-Templates und AI-Prompts liegen in
derselben Tabelle und laufen über die Handler ihrer Collection. So kann ein
neuer kind nicht versehentlich öffentlich lesbar werden.

Seed-Helper: `seedTextBlock` / `seedLegalContentFromJson` aus
`@cosmicdrift/kumiko-bundled-features/template-resolver/seeding`.

Content-Tree + Editor (Desktop-Web):

```typescript
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";

createKumikoApp({
  clientFeatures: [textBlocksClient({ navId: "myapp:nav:content", tenantId: SYSTEM_TENANT_ID })],
});
```

## Content-Collections

Eine Sammlung erscheint dort in der Nav, wo sie fachlich hingehört — statt alles
in einen zentralen "Content"-Bereich zu kippen. Deklariert wird sie **beim
Mounten**, nicht im Feature:

```typescript
createTemplateResolverFeature({
  collections: [
    {
      id: "reply-snippets",
      kind: "mail-html",
      access: { roles: ["Agent", "TenantAdmin"] },
      nav: { label: "mail:nav.snippets", parent: "mail:nav:root" },
    },
    {
      id: "ai-prompts",
      kind: "ai-prompt",
      access: { roles: ["PromptEngineer"] },
      nav: { label: "mail:nav.prompts", parent: "mail:nav:root" },
    },
  ],
});
```

`access` gehört an den Mount, weil ein bundled-feature das Rollenvokabular der
App nicht kennen kann — dasselbe Muster wie die `access`-Option von
`tags`/`folders`/`ledger`. Ohne Angabe gilt TenantAdmin + SystemAdmin.

Jede Collection bekommt **eigene Handler** — `<id>-list`, `<id>-item`,
`<id>-set` — die je die Access-Regel ihrer Collection tragen. Deshalb setzt der
Dispatcher die Trennung durch: wer Snippets pflegen darf, kommt an den
AI-Prompts nicht vorbei. Ein gemeinsamer Handler mit `kind`-Parameter müsste
die Vereinigung aller Rollen zulassen und im Body sortieren.

Der Payload trägt entsprechend **keinen** `kind` — `kind`, `ownership` und
`access` stammen aus der Deklaration. Zwei Collections dürfen denselben `kind`
mit unterschiedlichen Regeln führen.

`textBlocksClient()` bedient jede deklarierte Collection automatisch: ein
Folder-Tree pro Collection inklusive SSE-Refresh, Editor-Ziel mit der
`collectionId`. Die App reicht dafür nichts durch.

`nav.parent` darf auf ein fremdes Feature zeigen. Der Boot-Validator lehnt
dangling Refs ab — eine Collection unter einem nicht gemounteten Feature lässt
den Boot scheitern statt still aus der Sidebar zu verschwinden. Die
Sichtbarkeit des Knotens folgt `access`, sofern `nav.access` nichts anderes
sagt.

Ein "+" am Knoten braucht ein explizites `nav.createAction` (Ziel ist
üblicherweise `treeHandle.create`); ohne das listet die Collection nur, was
schon existiert. `nav.actions` setzt Hover-Actions auf die Zeile.

Speichern **veröffentlicht sofort** — Status `active`, leeres `variableSchema`.
Wer eine Draft-Stufe oder ein Variablen-Schema braucht, nimmt
`upsertSystem`/`upsertTenant` + `publish`.

### ownership: user vs. tenant

`ownership: "tenant"` (Default) heißt: ein Satz, den alle im Tenant teilen —
kuratierte Bausteine, AI-Prompts. `ownership: "user"` heißt: jeder Enduser
pflegt seine eigenen Einträge — Mail-Signaturen, persönliche Antwort-Bausteine.

User-owned Collections liegen in einer **eigenen Tabelle**
(`read_user_content_entries`, Entity `user-content-entry`) mit `ownerId NOT
NULL` und Unique-Index `(tenantId, ownerId, slug, kind, locale)`. Zwei Agents
können damit beide eine Signatur `standard` haben.

Warum nicht eine Tabelle mit nullbarer `ownerId`: das `content`-Feld dort
trägt `userOwned` (Name, Telefonnummer, Anschrift → crypto-shredding). Diese
Annotation wird **pro Entity** aufgelöst, nicht pro Zeile, und
`resolveSubjectForField` wirft, wenn die Owner-Spalte leer ist — jede
tenant-weite Mail-Template-Zeile würde beim Schreiben scheitern.

Beim Mounten einer user-owned Collection sind zwei Dinge Pflicht:

1. **Migration.** Die Entity kommt nur in den Schema-Diff, wenn mindestens eine
   user-owned Collection deklariert ist. Danach in der App
   `bunx kumiko-schema generate add-user-content` + `apply` — ohne die Tabelle
   antwortet der Handler in Prod mit 500.
2. **`template-resolver-user-data` mitmounten.** Die Entity trägt Subject-Daten;
   ohne den EXT_USER_DATA-Hook verweigert der Boot-Guard den Start. Das Feature
   liefert den Art.-20-Export; die Löschung (Art. 17) läuft über
   crypto-shredding, nicht über einen physischen DELETE — der wäre bei einer
   event-sourced Entity nicht replay-fest.

Der Locale-Fallback von `resolveTemplate` gilt für user-owned Einträge **nicht**:
sie werden gelistet und editiert, nie als Tenant/System-Override aufgelöst. Wer
im Client eigene *und* geteilte Bausteine zeigen will, mountet zwei Collections
nebeneinander und führt sie in der UI zusammen.

Unter `tenantIdOverride` (SystemAdmin) bleibt die Zeile die **eigene** des
Aufrufers im fremden Tenant — ein Admin editiert nie die Signatur eines anderen.

## Out-of-Scope

- Rendering (Markdown/MJML → HTML/PDF) — siehe `renderer-foundation`
- Resource-URL-Substitution (signed-URL vs. data-URI) — Caller-Verantwortung je nach kind
- Visual Template-Editor — `designer`-Bundle (geplant)
- A/B-Testing — eigenes Bundle wenn Bedarf real


