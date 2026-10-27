---
status: reference
verified: 2026-10-27
evidence: "packages/bundled-features/src/template-resolver/web/client-plugin.tsx, handlers/collection-list.query.ts, handlers/collection-item.query.ts, handlers/collection-set.write.ts, handlers/collection-shared.ts; samples/apps/use-all-bundled/src/run-config.ts; samples/apps/use-all-bundled/e2e/docs-content-editors.screenshots.spec.ts"
---

# Editing content collections

A content collection is a set of short texts that editors maintain in the app itself: reply snippets, mail signatures, AI prompts. The app declares the collection once in `createTemplateResolverFeature({ collections })`, and every collection gets its own entry in the sidebar with a list of its entries and an editor. This guide walks through that editor from the user's side. The images come from the `use-all-bundled` sample, which declares two collections:

| Collection | Ownership | Who sees an entry |
|---|---|---|
| Snippets (`reply-snippets`) | `tenant` (default) | everyone in the tenant who may open the collection |
| Signatures (`signatures`) | `user` | only the user who wrote it |

## Open an entry and edit it

The collection shows up as a sidebar group with one row per entry. Click a row to open it in the editor. The header shows the entry title, its key (slug) and the language.

With `contentFormat: "rich"` the editor is a WYSIWYG field with a toolbar for bold, italic, two heading levels and bulleted or numbered lists. When the collection declares a `variableSchema`, the editor adds one button per variable under the text. A click inserts the placeholder at the cursor, here `{{orderId}}` at the end of the last line:

![Snippet "Refund approved" in the rich editor: toolbar above the text, placeholders customerName, orderId and agentName in the text and as insert buttons below it](/screenshots/content-collections/snippet-editor.png)

## Preview with sample data

**Preview** next to the content label renders the text with the example values from `variableSchema` in place of the placeholders, so the editor sees what a customer would read. **Edit** switches back.

![The same snippet in preview: Hi Max Mustermann, refund for A-1042, signed Alex Bruns](/screenshots/content-collections/snippet-preview.png)

**Save** writes the entry. For a tenant-wide collection the change is visible to every colleague who opens the collection.

## Create your own entry in a per-user collection

There is no generic "new entry" form. The editor opens empty for a key that has no entry yet, and the first save creates it. An app makes this reachable with `nav.createAction`, the **+** next to the collection name. The sample opens the editor on the key `default`, which gives every user exactly one signature:

```ts illustration
nav: {
  label: "templateResolver:nav.signatures",
  createAction: {
    icon: "plus",
    label: "New signature",
    target: {
      featureId: "template-resolver",
      action: "edit",
      args: { slug: "default", locale: "en", collectionId: "signatures" },
    },
  },
},
```

Fill in the title, write the text and format it with the toolbar:

![Empty signature editor after clicking the plus: title My signature, three lines with the name in bold](/screenshots/content-collections/signature-new.png)

After **Save** and one reload the entry appears under **Signatures**. Another user opening the same collection sees only their own signature, never this one:

![Signatures group in the sidebar now lists My signature; the editor shows the saved text with the bold name](/screenshots/content-collections/signature-saved.png)

The text of a user-owned entry is personal data of its owner. With a PII key service configured it is stored encrypted and decrypted for the owner on read; the GDPR export and erasure cover it through `createTemplateResolverUserDataFeature()`.

## Current limits

| Limit | Effect | Workaround |
|---|---|---|
| Only `TenantAdmin` and `SystemAdmin` get the **Save** button | a `TenantMember` who may open a collection sees it read-only, even their own signatures | grant the editing users `TenantAdmin` |
| A per-user collection gets no live refresh | after the first save of a new entry the sidebar shows it only after a reload | reload the page once |
| No built-in create form | new entries need a `createAction` with a fixed key, or a seed | declare one key per expected entry |
| `textBlocksClient({ tenantId })` points every collection tree at that tenant | the tree sends `tenantIdOverride`, which only a `SystemAdmin` may send, so other users cannot load the trees; a `createAction` without the same override writes into the session tenant and the entry never shows up | in apps where editors are not `SystemAdmin`, leave `tenantId` unset; with it set, add `tenantIdOverride` to the target args, as the sample does |

## Run the screenshots yourself

```bash
cd samples/apps/use-all-bundled
SCREENSHOT_DIR=../../../docs/screenshots bun run docs-content-editors
```
