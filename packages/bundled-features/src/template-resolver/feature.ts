import {
  type ContentCollectionDefinition,
  createSystemConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { isCollectionRefusedKind } from "./constants.ts";
import { bySlugQuery } from "./handlers/by-slug.query.ts";
import { byTenantQuery } from "./handlers/by-tenant.query.ts";
import { makeCollectionItemQuery } from "./handlers/collection-item.query.ts";
import { makeCollectionListQuery } from "./handlers/collection-list.query.ts";
import { makeCollectionSetWrite } from "./handlers/collection-set.write.ts";
import { copyLocaleWrite } from "./handlers/copy-locale.write.ts";
import { diffToSystemQuery } from "./handlers/diff-to-system.query.ts";
import { discardDraftSystemWrite, discardDraftWrite } from "./handlers/discard-draft.write.ts";
import { exportBundleQuery } from "./handlers/export-bundle.query.ts";
import { findByIdQuery } from "./handlers/find-by-id.query.ts";
import { importBundleWrite } from "./handlers/import-bundle.write.ts";
import { importBundleSystemWrite } from "./handlers/import-bundle-system.write.ts";
import { layoutSourceQuery } from "./handlers/layout-source.query.ts";
import { listQuery } from "./handlers/list.query.ts";
import { overviewQuery } from "./handlers/overview.query.ts";
import { previewQuery } from "./handlers/preview.query.ts";
import { resetToSystemWrite } from "./handlers/reset-to-system.write.ts";
import { resourceLinkPdfWrite } from "./handlers/resource-link-pdf.write.ts";
import { resourceRemoveWrite } from "./handlers/resource-remove.write.ts";
import { resourceUploadWrite } from "./handlers/resource-upload.write.ts";
import { sendTestWrite } from "./handlers/send-test.write.ts";
import { setWrite } from "./handlers/set.write.ts";
import { tenantOverridesQuery } from "./handlers/tenant-overrides.query.ts";
import {
  archiveSystemWrite,
  archiveWrite,
  publishSystemWrite,
  publishWrite,
} from "./handlers/toggle-status.write.ts";
import { upsertSystemWrite } from "./handlers/upsert-system.write.ts";
import { upsertTenantWrite } from "./handlers/upsert-tenant.write.ts";
import { usageQuery } from "./handlers/usage.query.ts";
import { validateQuery } from "./handlers/validate.query.ts";
import { templateResourceEntity } from "./table.ts";
import { userContentEntryEntity } from "./user-content-table.ts";

// template-resolver — structured template storage with tenant-override
// hierarchy, locale fallback and resource linking via file-foundation.
// Plan doc: kumiko-platform/docs/plans/features/template-resolver.md
//
// Consumption paths:
//   - Render time: ctx.templateResolver.resolveTemplate(...) (see api.ts)
//   - Admin UI: write/query handlers (upsertSystem, upsertTenant, publish, archive, publishSystem, archiveSystem, resetToSystem, findById, list, usage, tenantOverrides, diffToSystem)
//   - Cross-feature: requireTemplateResolver(ctx, callerName)
export type TemplateResolverOptions = {
  /** Content collections this app mounts. Declared here rather than inside the
   *  feature because `access` needs the host's role vocabulary — a bundled
   *  feature cannot know that an app calls its support staff "Agent". Same
   *  reasoning as the `access` option on tags/folders/ledger.
   *
   *  Each collection gets its own list/item/set handlers named
   *  `<id>-list` / `<id>-item` / `<id>-set`, each carrying that collection's
   *  access rule, so the dispatcher enforces the separation instead of a
   *  branch in a shared handler. */
  readonly collections?: readonly ContentCollectionDefinition[];
};

function assertCollectionKindsAllowed(collections: readonly ContentCollectionDefinition[]): void {
  for (const collection of collections) {
    if (isCollectionRefusedKind(collection.kind)) {
      throw new Error(
        `template-resolver: collection "${collection.id}" uses kind "${collection.kind}", which collections may not write`,
      );
    }
  }
}

export function createTemplateResolverFeature(opts: TemplateResolverOptions = {}) {
  const collections = opts.collections ?? [];
  assertCollectionKindsAllowed(collections);
  const hasUserOwned = collections.some((c) => c.ownership === "user");
  return defineFeature("template-resolver", (r) => {
    r.describe(
      [
        "Every piece of editable text lives here, in one entity: mail bodies, notification texts, PDF document templates, AI prompts and plain text blocks. What a record is used for is the `kind` (`notification`, `mail`, `mail-layout`, `document-pdf`, `pdf-layout`, `ai-prompt`, `text-block`, `snippet`, `image-snapshot`).",
        "Reading is one call — `ctx.templateResolver.resolveTemplate({ tenantId, slug, kind, locale })`. It walks four levels: tenant+locale, system+locale, tenant+fallback-locale, system+fallback-locale. A tenant overrides a system default by simply having its own record; no application code changes. Writing programmatically goes through the `upsertSystem`, `upsertTenant`, `publish` and `archive` write handlers; a SystemAdmin retires or restores a system default with `publishSystem` and `archiveSystem`, and a tenant drops its override with `resetToSystem`. Saving a draft over an active template keeps the active version served and stores the edit beside it (column `draft`); `publish` makes it the served version, `discardDraft` / `discardDraftSystem` throws it away.",
        "Text an editor should be able to change belongs in a collection, declared at mount: `createTemplateResolverFeature({ collections: [{ id, kind, access: { roles }, nav }] })`. It appears in the navigation, and `access` is part of the mount because a bundled feature cannot know the host's roles. Each collection gets its own `<id>-list` / `<id>-item` / `<id>-set` handlers, so the dispatcher enforces the separation.",
        "How a collection is edited follows from `contentFormat`: `plain` gives a text area, `rich` a small WYSIWYG (bold, italic, headings, lists, links), `markdown` a text area that stores markdown text (same insertable chips as `plain`). All three offer the collection's `variableSchema` as insertable chips and a preview rendered with sample data — an editor sees what `{{firstName}}` becomes without sending a mail. An app can register its own editor for a format; the last `clientFeature` that registers a format wins (a conflict logs a warning).",
        'A collection is tenant-wide by default. With `ownership: "user"` every user keeps their own entries — mail signatures being the obvious case. Those rows live in the separate `user-content-entry` entity and count as user data, so mounting one also requires the `template-resolver-user-data` feature and a migration on the app side.',
        "`validate` dry-runs the write pipeline for a draft (sanitizer, layout rules, placeholders) and reports what the template uses and misses. `export-bundle` / `import-bundle` (and `import-bundle-system`) move one template with all locales and resource files between tenants or environments; `copy-locale` starts a translation from an existing locale. Layouts are structured: a mail or PDF layout is `data-header` / `data-content` / `data-signature` / `data-footer` regions, and mjml layout source is system-only.",
        "`preview` renders a draft (or the stored template) with sample values taken from the `example` of each declared variable, through the same gates and the same mail renderer as a real send, and returns subject, html, `displayHtml` (the html with cid images as data URIs for an editor), text, attachments (inline images and files) and `checks` (images resolved, plain text present, size under 10 MiB, required placeholders used); nothing is saved or sent. `send-test` mails that rendering to the calling user's own address only, subject prefixed with `[TEST]`, at most 10 per user and hour; it needs `delivery`, `channel-email` and `renderer-mail-html` to be mounted.",
        'Images used by a template (`<img data-resource="logo">`) are uploaded with `resourceUpload`, which re-encodes them, stores a file and links it under the key; `resourceRemove` unlinks it. `linkedResources` is written only through these two handlers. With `purpose: "attachment"` and a `fileName`, `resourceUpload` stores a PDF, PNG or JPEG as a file attachment of a mail template (original bytes, at most 10) that the mail renderer attaches after the inline images. `resourceLinkPdf` instead links a `document-pdf` template under a key: every mail sent from the template then carries that PDF, rendered at send time with the mail\'s own variables and locale, under a file name pattern such as `invoice-{{number}}.pdf`; files and linked PDFs share the limit of 10.',
        "Replaces the former `text-content` feature; its blocks now live here as kind `text-block`.",
      ].join("\n\n"),
    );
    r.uiHints({
      displayLabel: "Template Resolver",
      category: "notifications",
      recommended: false,
    });
    r.config({
      keys: {
        resourceMaxBytes: createSystemConfig("number", { default: 2_097_152, bounds: { min: 1 } }),
      },
    });
    r.entity({ name: "template-resource", ...templateResourceEntity });
    // Only when the app actually mounts a user-owned collection: the entity's
    // `content` is `userOwned`, which makes it subject data — the boot guard
    // then requires an EXT_USER_DATA hook (mount `template-resolver-user-data`).
    // Registering it unconditionally would impose that on every app.
    if (hasUserOwned) r.entity({ name: "user-content-entry", ...userContentEntryEntity });

    const handlers = {
      upsertSystem: r.writeHandler(upsertSystemWrite),
      upsertTenant: r.writeHandler(upsertTenantWrite),
      publish: r.writeHandler(publishWrite),
      archive: r.writeHandler(archiveWrite),
      publishSystem: r.writeHandler(publishSystemWrite),
      archiveSystem: r.writeHandler(archiveSystemWrite),
      discardDraft: r.writeHandler(discardDraftWrite),
      discardDraftSystem: r.writeHandler(discardDraftSystemWrite),
      resetToSystem: r.writeHandler(resetToSystemWrite),
      set: r.writeHandler(setWrite),
      importBundle: r.writeHandler(importBundleWrite),
      importBundleSystem: r.writeHandler(importBundleSystemWrite),
      copyLocale: r.writeHandler(copyLocaleWrite),
      resourceUpload: r.writeHandler(resourceUploadWrite),
      resourceRemove: r.writeHandler(resourceRemoveWrite),
      resourceLinkPdf: r.writeHandler(resourceLinkPdfWrite),
      sendTest: r.writeHandler(sendTestWrite),
    };

    const queries = {
      findById: r.queryHandler(findByIdQuery),
      list: r.queryHandler(listQuery),
      bySlug: r.queryHandler(bySlugQuery),
      byTenant: r.queryHandler(byTenantQuery),
      usage: r.queryHandler(usageQuery),
      overview: r.queryHandler(overviewQuery),
      layoutSource: r.queryHandler(layoutSourceQuery),
      tenantOverrides: r.queryHandler(tenantOverridesQuery),
      diffToSystem: r.queryHandler(diffToSystemQuery),
      validate: r.queryHandler(validateQuery),
      preview: r.queryHandler(previewQuery),
      exportBundle: r.queryHandler(exportBundleQuery),
    };

    for (const collection of collections) {
      r.contentCollection(collection);
      r.queryHandler(makeCollectionListQuery(collection));
      r.queryHandler(makeCollectionItemQuery(collection));
      r.writeHandler(makeCollectionSetWrite(collection));
    }

    // Visual-tree actions for the text-block content tree. The handle is
    // propagated through the setup export so other features can build
    // compile-time-typed cross-feature edit targets.
    // r.treeActions keeps literal types (const generic); the args only declare string-typed slots.
    const emptyString: string = "";
    const treeHandle = r.treeActions({
      edit: { args: { slug: emptyString, locale: emptyString } },
      list: {},
      create: { args: { folder: emptyString } },
    });

    return { handlers, queries, treeHandle };
  });
}
