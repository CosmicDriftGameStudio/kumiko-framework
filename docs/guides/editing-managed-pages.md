---
status: reference
verified: 2026-10-27
evidence: "packages/bundled-features/src/managed-pages/feature.ts, screens, table.ts; samples/apps/use-all-bundled/src/run-config.ts; samples/apps/use-all-bundled/e2e/docs-content-editors.screenshots.spec.ts"
---

# Editing managed pages

`managed-pages` lets a tenant maintain public pages such as "About us", "Pricing" or "Shipping and returns" without a deploy. An editor writes the page in Markdown in the admin area, switches it to published, and the app serves it at `/p/<slug>`. This guide follows that path from the editor's side. The images come from the `use-all-bundled` sample.

## Where pages live

The feature ships the list and edit screens (`managed-pages:screen:page-list`); the app puts them into a workspace with `r.nav`. In the sample they sit under **Pages** in the tenant administration. Only `TenantAdmin` and `SystemAdmin` can open them.

The list shows one row per page and language with its publish state. A draft is stored but not public:

![Pages list with two rows: about in English, About Acme, Published; pricing in English, Pricing, Draft](/screenshots/managed-pages/page-list.png)

## Create and publish a page

**New** opens the page form:

| Field | Meaning |
|---|---|
| Slug | the last part of the public URL, `shipping` becomes `/p/shipping` |
| Language | language code; one page per slug and language |
| Title | page title, also the `<title>` of the public page |
| Description | meta description for search engines and link previews |
| OG image | optional https URL of the preview image for social links |
| Published | off keeps the page a draft, on makes it public |
| Content | the page body in Markdown: headings, lists, links, emphasis |

![Page form filled in for shipping: title Shipping and returns, a description, Published switched on, Markdown content with Delivery times and Returns sections](/screenshots/managed-pages/new-page.png)

**Save** creates the page, and it appears in the list as Published. To take a page offline again, open it, switch **Published** off and save. Deleting is in the row menu.

## Where the page shows up

A published page is served at `/p/<slug>` on the tenant's host. The app's `resolveApexTenant` maps the host to the tenant, so each tenant on its own subdomain or domain gets its own pages. `?lang=de` selects another language; without it the feature serves `defaultLang` (default `en`). The Markdown is rendered as safe HTML inside the default layout, or inside the app's `wrapLayout`:

![Public page at /p/shipping: heading Shipping and returns, an intro sentence, Delivery times with two bullet points and a Returns section](/screenshots/managed-pages/public-page.png)

A draft answers with 404, just like a slug that does not exist. Visitors can never see a page before the editor publishes it.

The page picks up the tenant branding (title, accent color, logo) from the branding settings screen when it is set. The sample sets none, so the page renders plain. With `allowCustomCss: true` tenants can also add scoped custom CSS there.

`managed-pages:query:by-tenant-published` lists the published pages for sitemap consumers such as the `seo` feature; an app passes it to `seo` to list the pages in `sitemap.xml`.

## Run the screenshots yourself

```bash
cd samples/apps/use-all-bundled
SCREENSHOT_DIR=../../../docs/screenshots bun run docs-content-editors
```
