# template-resolver

Structured content storage with tenant override hierarchy, locale fallback, and resource linking via `file-foundation`. One entity (`template-resource`) for all content types: render templates (`mail`, `document-pdf`, `notification`, `image-snapshot`), layouts (`mail-layout`, `pdf-layout`), Markdown text blocks (`text-block`, formerly the `text-content` feature), and AI prompts (`ai-prompt`).

## Mount

```typescript
// App bootstrap
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";

const features = [
  createTemplateResolverFeature(),
  // ... additional features
];

const app = createKumikoApp({
  features,
  extraContext: ({ db }) => ({
    templateResolver: createTemplateResolverApi(db, registry),
  }),
});
```

## Consumption (in feature handlers)

```typescript
import { requireTemplateResolver } from "@cosmicdrift/kumiko-bundled-features/template-resolver";

async function someHandler(ctx) {
  const templateResolver = requireTemplateResolver(ctx, "someHandler");
  const template = await templateResolver.resolveTemplate({
    tenantId: ctx.user.tenantId,
    slug: "nka-versand",
    kind: "mail",
    locale: "de",
  });
  // use template.content + template.meta + template.variableSchema + template.linkedResources
  // ...
}
```

## Kinds, format, and meta

| kind | contentFormat | meta |
|---|---|---|
| `mail` | `html` (document schema, rebuilt server-side) | Required: `subject`; optional `previewText`, `layoutSlug`, `category` (`transactional`/`marketing`), `senderName`, `replyTo` |
| `mail-layout` | `mjml` | empty (`{}`) or missing |
| `pdf-layout` | `html` | empty (`{}`) or missing |
| `document-pdf` | `html` | missing |
| remaining kinds | arbitrary | missing |

`meta` is stored as JSON in the `meta` column and is validated on write per kind against
`template-meta.ts` (errors as field issues on `meta.*`). Subject and preview text allow only simple
placeholders (`{{name}}`, `{{name.field}}`), with no line breaks.

Slugs are kebab-case segments joined with `:` (`templateSlugSchema`); notification templates
use their qualified name `feature:notify:name`.

## Placeholder validation (kind `mail`)

Variables come from the notification with the same qualified name
(`r.notification({ variables })`), otherwise from the row's `variableSchema`. System placeholders
(`tenantName`, `signature`, `imprint`, `unsubscribeUrl`) and the resource key `logo` are always allowed.

- `upsertSystem` and `upsertTenant` reject unknown placeholders (field issue on `content`).
- `upsertSystem` and `upsertTenant` with `status: "active"` additionally require every `required` variable to be used. A tenant draft may be incomplete and returns `validation`.
- `publish` checks the stored row again.
- `seedSystemTemplate` throws for both problems.

## Seeding notification templates

`r.notification({ variables, template, meta })` includes text and meta with the code.
`seedNotificationTemplates(db, registry)` (from `.../template-resolver/seeding`) writes them
as system templates per locale; `applyBootSeeds` calls this at boot. The code is authoritative:
changed text updates the row, unchanged text produces no event. Tenant overrides remain untouched.

## Resolver order (four-stage fallback)

1. `tenantId` + requested locale
2. `SYSTEM_TENANT_ID` + requested locale
3. `tenantId` + `FALLBACK_LOCALE` (default "de")
4. `SYSTEM_TENANT_ID` + `FALLBACK_LOCALE`

If nothing is found, `TemplateNotFoundError`.

## Boot seeding (system templates)

```typescript
import { seedSystemTemplate } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";

// runProdApp seeds, idempotent, skips by default if the slug exists
await seedSystemTemplate(db, {
  slug: "welcome-email",
  kind: "mail",
  locale: "de",
  content: '<p>Welcome, <span data-variable="name"></span></p>',
  contentFormat: "html",
});
```

`ifExists: "update"` for authoritative re-seeds, for example after a template content release.

## Admin workflows (write handlers + queries)

| Handler | QN | Who | What |
|---|---|---|---|
| `TemplateResolverHandlers.upsertSystem` | `template-resolver:write:upsert-system` | SystemAdmin | Creates or updates system default templates (`SYSTEM_TENANT_ID`, scope='system', status='active') |
| `TemplateResolverHandlers.upsertTenant` | `template-resolver:write:upsert-tenant` | TenantAdmin (own tenant) + SystemAdmin via `tenantIdOverride` | Creates or updates tenant overrides (scope='tenant'), default status='draft' |
| `TemplateResolverHandlers.publish` | `template-resolver:write:publish` | TenantAdmin (own tenant) | Sets status='active' |
| `TemplateResolverHandlers.archive` | `template-resolver:write:archive` | TenantAdmin (own tenant) | Sets status='archived' (the resolver ignores it afterward) |
| `TemplateResolverHandlers.publishSystem` | `template-resolver:write:publish-system` | SystemAdmin | Sets status='active' on a system default, with the same mail validation as `publish` |
| `TemplateResolverHandlers.archiveSystem` | `template-resolver:write:archive-system` | SystemAdmin | Sets status='archived' on a system default; tenants without an override fall through |
| `TemplateResolverHandlers.resetToSystem` | `template-resolver:write:reset-to-system` | TenantAdmin (own tenant) | Archives the own override so that the active system template applies again; without an active system template, `no_system_template` |
| `TemplateResolverQueries.findById` | `template-resolver:query:find-by-id` | TenantAdmin + User (own tenant, system templates visible) | Raw lookup for the edit UI |
| `TemplateResolverQueries.list` | `template-resolver:query:list` | same | Filters by kind/locale/status, optionally includeSystem |
| `TemplateResolverQueries.usage` | `template-resolver:query:usage` | TenantAdmin | Which notifications use a mail template or mail layout, from the registry |
| `TemplateResolverQueries.overview` | `template-resolver:query:overview` | TenantAdmin + SystemAdmin | One row per slug and type, mail, PDF, layouts, with origin, languages, status, version, layout, and usage; searchable, filterable, sortable, and pageable |
| `TemplateResolverQueries.layoutSource` | `template-resolver:query:layout-source` | TenantAdmin + SystemAdmin | Own and system version of a layout, header/signature/footer regions of the effective HTML version, storage locale; MJML source only for SystemAdmin |
| `TemplateResolverQueries.tenantOverrides` | `template-resolver:query:tenant-overrides` | SystemAdmin | Number of active/draft overrides of a system template and total active tenants, numbers only |
| `TemplateResolverQueries.diffToSystem` | `template-resolver:query:diff-to-system` | TenantAdmin (own tenant) | Block and meta comparison of a tenant override with the system template |

**SystemAdmin cross-tenant access for publish/archive/findById:** deferred (Task 8), `upsertTenant` already has `tenantIdOverride`; publish/archive only need this when a system admin panel curates templates belonging to other tenants. `ctx.db` is tenant-scoped, foreign IDs result in NotFound without an override.

## Status lifecycle

```
upsertSystem  ──┐
                ├──► status: "active" (system default active immediately)
upsertTenant  ──┴──► status: "draft" (default) | "active" (explicit)

publish ───────► status: "active" (publishes an open draft)
archive ───────► status: "archived"
discardDraft ──► discards the draft alongside the active version
```

A draft over an active row (`upsertTenant` without `status`, `copy-locale`, `import-bundle`) is stored as JSON in `draft` beside the row; the main fields remain the delivered version. `find-by-id` and `layout-source` return the working version, the draft if present, otherwise the stored version, with `active { version, since }`.
The resolver returns **only** templates with `status: "active"`. draft/archived are ignored.

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

The harness checks `TemplateNotFoundError` propagation, locale fallback, and, when `resolveResources` is provided, missing resource keys.

## Text blocks (`kind: "text-block"`)

Marketing, FAQ, and legal texts use the same store, but a separate write path: `set.write` carries
`title` + `folder` (content tree) and has no draft status, saving publishes.

| Handler | QN | Who | What |
|---|---|---|---|
| `TemplateResolverHandlers.set` | `template-resolver:write:set` | TenantAdmin + SystemAdmin (via `tenantIdOverride`, also on `SYSTEM_TENANT_ID`) | Upserts one resource per `(tenantId, slug, kind, locale)` |
| `TemplateResolverQueries.bySlug` | `template-resolver:query:by-slug` | anonymous + User + Admins | One text block, the public read for landing/legal pages |
| `TemplateResolverQueries.byTenant` | `template-resolver:query:by-tenant` | anonymous + User + Admins | All text blocks of a tenant for the content tree |
| `<collection>-list` / `-item` / `-set` | `template-resolver:query:<id>-list` … | as declared | Per content collection, see below |

The two public queries are hardcoded to `kind: "text-block"` and accept **no** kind parameter. Mail
templates and AI prompts are stored in the same table and use the handlers of their collection. This
prevents a new kind from accidentally becoming publicly readable.

Seeding helpers: `seedTextBlock` / `seedLegalContentFromJson` from
`@cosmicdrift/kumiko-bundled-features/template-resolver/seeding`.

Content tree + editor (desktop web):

```typescript
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";

createKumikoApp({
  clientFeatures: [textBlocksClient({ navId: "myapp:nav:content", tenantId: SYSTEM_TENANT_ID })],
});
```

## Content collections

A collection appears in the navigation where it belongs functionally, instead of putting everything
in one central "Content" section. It is declared **when mounting**, not in the feature:

```typescript
createTemplateResolverFeature({
  collections: [
    {
      id: "reply-snippets",
      kind: "mail",
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

`access` belongs on the mount because a bundled feature cannot know the app's role vocabulary, the same
pattern as the `access` option of `tags`/`folders`/`ledger`. Without an explicit value, TenantAdmin + SystemAdmin applies.

Each collection gets **its own handlers**, `<id>-list`, `<id>-item`, `<id>-set`, each carrying the
access rule of its collection. The dispatcher therefore enforces separation: anyone allowed to manage
snippets cannot access the AI prompts. A shared handler with a `kind` parameter would have to allow
the union of all roles and sort in the body.

Accordingly, the payload carries **no** `kind`; `kind`, `ownership` and `access` come from the
declaration. Two collections may use the same `kind` with different rules.

`textBlocksClient()` automatically serves every declared collection: one folder tree per collection,
including SSE refresh, and an editor target with the `collectionId`. The app passes nothing through for this.

`nav.parent` may point to another feature. The boot validator rejects dangling references, a collection
under an unmounted feature causes boot to fail instead of silently disappearing from the sidebar. Node
visibility follows `access` unless `nav.access` specifies otherwise.

A "+" on the node requires an explicit `nav.createAction`, whose target is usually
`treeHandle.create`; without it, the collection only lists existing items. `nav.actions` adds hover actions to the row.

Saving **publishes immediately**, with status `active` and an empty `variableSchema`.
Anyone who needs a draft stage or a variable schema uses
`upsertSystem`/`upsertTenant` + `publish`.

### ownership: user vs. tenant

`ownership: "tenant"` (default) means one set shared by everyone in the tenant,
curated snippets and AI prompts. `ownership: "user"` means each end user maintains their own entries,
mail signatures and personal reply snippets.

User-owned collections are stored in a **separate table**
(`read_user_content_entries`, entity `user-content-entry`) with `ownerId NOT
NULL` and unique index `(tenantId, ownerId, slug, kind, locale)`. This allows two agents
to each have a `standard` signature.

Why not one table with a nullable `ownerId`: the `content` field there carries
`userOwned` data, name, phone number, address, for crypto-shredding. This annotation is resolved
**per entity**, not per row, and `resolveSubjectForField` throws when the owner column is empty,
so every tenant-wide mail template row would fail on write.

When mounting a user-owned collection, two things are required:

1. **Migration.** The entity is included in the schema diff only if at least one
   user-owned collection is declared. Then in the app run
   `bunx kumiko-schema generate add-user-content` + `apply`, without the table
   the handler returns 500 in production.
2. **Mount `template-resolver-user-data` as well.** The entity carries subject data;
   without the EXT_USER_DATA hook, the boot guard refuses to start. The feature provides the Art. 20
   export; deletion (Art. 17) uses crypto-shredding, not a physical DELETE, which would not be
   replay-safe for an event-sourced entity.

The locale fallback of `resolveTemplate` does **not** apply to user-owned entries:
they are listed and edited, never resolved as tenant/system overrides. Anyone who wants to show their own
and shared snippets in the client mounts two collections side by side and combines them in the UI.

With `tenantIdOverride` (SystemAdmin), the row remains the caller's **own** row in the foreign tenant,
an admin never edits another user's signature.

## Validation, layouts, bundles

- `validate` (query) dry-runs the write pipeline: `canSave`, `canPublish`, used/unknown/missing placeholders, and available variables. `mail`, `document-pdf`, `pdf-layout`, and `mail-layout` pass through the same placeholder gate; `page`/`pages` exist only in `document-pdf` and `pdf-layout`.
- `preview` (query, TenantAdmin/SystemAdmin) renders a draft or, without `content`, the stored template with example values from the `example` of each declared variable, two rows for lists, fixed replacement values without `example`. The draft passes through the same gates as saving, and a mail through the actual mail renderer. Response: subject, HTML, `displayHtml` (mail only: `cid:` images as data URIs for the editor, 5 MiB budget), text, attachments (`kind: "inline"` with `cid` or `kind: "file"`, each with size), and `checks` (`resources_resolved`, `text_present`, `size_under_cap` with 10 MiB, `required_placeholders`). `document-pdf` returns the cleaned body and layout regions, not a PDF.
- `send-test` (write, TenantAdmin/SystemAdmin) sends the rendered mail only to the caller's own address, with `[TEST] ` in the subject, at most 10 per user and hour. There is no recipient input. Requires `delivery`, `channel-email`, and `renderer-mail-html`.
- Layouts: tenant `mail-layout` and `pdf-layout` are structured HTML with a `data-content` slot and regions, header, signature, footer. Raw MJML with `{{{content}}}` exactly once may only be written by the system.
- `export-bundle`, `import-bundle`, `import-bundle-system`: one template with all locales and resource files, base64 encoded, as a standalone bundle; existing targets only with `overwrite`. A system import with resources requires a caller in the system tenant.
- `copy-locale`: starting point for translations, copies as a tenant draft. With `scope: "system"` (SystemAdmin only), copies a system template as a system draft; other callers receive 403.
- Mail attachments: `resource-upload` with `purpose: "attachment"` and `fileName` stores a PDF, PNG, or JPEG file, validated by its contents and original bytes, at most 10 per mail template, alongside inline images. `resource-remove`, `copy-locale`, and the bundles include them, with bundle entry `purpose: "attachment"`. The mail renderer attaches them after the inline images.
- `r.notification(..., { record: { entity, map } })` maps an entity row to the declared variables (`mapRecordToVariables`); boot validates the entity, variables, and field paths.

## Out of scope

- Rendering (Markdown/MJML to HTML/PDF), see `renderer-foundation`
- Resource URL substitution (signed URL vs. data URI), caller responsibility by kind
- Visual template editor, `designer` bundle (planned)
- A/B testing, separate bundle if there is real demand
