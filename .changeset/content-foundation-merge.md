---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

**BREAKING: `text-content` merged into `template-resolver`.**

The `text-content` feature is gone. Its text blocks now live in
`template-resolver` as `kind: "text-block"` rows of `read_template_resources`,
which gains a nullable `title` and `folder` column. `ai-prompt` joins the kind
set. `RENDER_KINDS` is unchanged (renderer plugins keep their exact domain);
the full entity domain is the new `TEMPLATE_KINDS`.

Migration for consuming apps:

| before | after |
|---|---|
| `createTextContentFeature()` | `createTemplateResolverFeature()` |
| `@cosmicdrift/kumiko-bundled-features/text-content` | `.../template-resolver` |
| `.../text-content/seeding` → `seedTextBlock` | `.../template-resolver/seeding` → `seedTextBlock` |
| `.../text-content/web` → `textContentClient()` | `.../template-resolver/web` → `textBlocksClient()` |
| `extraContext: { textContent: createTextContentApi(db) }` | `extraContext: { templateResolver: createTemplateResolverApi(db) }` (auto-wired by runProdApp/runDevApp) |
| `textContent.getBlock({ tenantId, slug, lang })` | `templateResolver.findExact({ tenantId, slug, kind: "text-block", locale })` |
| `text-content:write:set` `{ slug, lang, title, body }` | `template-resolver:write:set` `{ slug, locale, title, content }` |
| `text-content:query:by-slug` `{ slug, lang }` | `template-resolver:query:by-slug` `{ slug, locale }` |
| `text-content:query:by-tenant` | `template-resolver:query:by-tenant` |
| `TestStackPreset "text-content"` | `TestStackPreset "template-resolver"` |

`composePagesStack()` no longer mounts the content foundation — it now returns
`legal-pages` only, because `template-resolver` ships in `composeRendererStack()`
and `createRegistry` rejects duplicate features. Apps composing pages without
the renderer stack add `createTemplateResolverFeature()` themselves.

DB migration per app: add `title` + `folder` to `read_template_resources`, copy
`read_text_blocks` rows over as `kind = 'text-block'` (`lang` → `locale`,
`body` → `content`, `scope` = `'system'` for `SYSTEM_TENANT_ID` else
`'tenant'`, `status` = `'active'`), then drop `read_text_blocks`.
