---
status: reference
verified: 2026-10-18
evidence: "packages/renderer-mail-html/src/index.ts; packages/renderer-mail-html/src/render.ts; packages/renderer-puppeteer-client/src/index.ts; packages/renderer-puppeteer-client/src/http-client.ts; apps/puppeteer-service/src/egress-guard.ts; apps/puppeteer-service/src/server.ts"
---

# Renderer parity with the former Enterprise copies

The Enterprise copies of the renderer packages and the puppeteer service were removed (Enterprise 56ad50a2); consumers use `@cosmicdrift/kumiko-renderer-mail-html` and `@cosmicdrift/kumiko-renderer-puppeteer-client`.

The Enterprise scope was `@cosmicdriftgamestudio/kumiko-renderer-*`. Where the framework differs, the table says so.

## renderer-mail-html

| Export | Enterprise name | FW name | Status |
|---|---|---|---|
| Package | `@cosmicdriftgamestudio/kumiko-renderer-mail-html` | `@cosmicdrift/kumiko-renderer-mail-html` | different scope |
| Subpaths `.` and `./seeding` | present | present | same |
| `DEFAULT_MAIL_LAYOUT_MJML` | `DEFAULT_MAIL_LAYOUT_MJML` | `DEFAULT_MAIL_LAYOUT_MJML` | same name, different layout (variables `tenantName`, `subject`, `previewText`, `lang`, `imprint`, `mailFooterHtml`; no `appName`) |
| `createRendererMailHtmlFeature` | `createRendererMailHtmlFeature()`, kind `mail-html` | `createRendererMailHtmlFeature(options)`, kind `mail`; options `{ footer, brandSuffix }` | different signature and kind |
| `mailHtmlRender` | payload `{ content, variables, locale }`, kind `mail-html` | payload `{ slug, locale, variables, unsubscribeUrl?, draft? }`, kind `mail`; response adds `subject`, `previewText` | different payload: renders stored document templates |
| `seedSystemMailLayout` (`/seeding`) | writes slug `mail-layout`, kind `mail-html` directly | writes slug `default`, kind `mail-layout` through `seedSystemTemplate` (idempotent) | same name, different rows |
| `SeedSystemMailLayoutOptions` (`/seeding`) | `{ mjml?, locale? }` | `{ mjml?, locale?, slug? }` | FW adds `slug` |
| Document kit, footer and brand-suffix helpers and types | absent | `compileDocumentSource`, `createDocumentHandlebars`, `MailFooter`, `MailBrandSuffixResolver`, `MailHtmlRenderOptions` and others | FW only |

Protections that carry over unchanged: a layout resolution error other than `TemplateNotFoundError` is a `RendererError` with code `other` (no silent fallback), MJML and layout Handlebars errors are code `other`, and the plain-text part comes from `html-to-text` with `hideLinkHrefIfSameAsText`.

Deliberately absent in the framework:

- The Markdown path and its raw-HTML escaping. Bodies are sanitized document HTML rendered by an isolated Handlebars instance with HTML escaping.
- A free `content` payload. The request names a template slug.

## renderer-puppeteer-client

| Export | Enterprise name | FW name | Status |
|---|---|---|---|
| Package | `@cosmicdriftgamestudio/kumiko-renderer-puppeteer-client` | `@cosmicdrift/kumiko-renderer-puppeteer-client` | different scope |
| `ClientConfig`, `loadClientConfig` | present | present | same |
| `countPdfPages` | present | present | same |
| `createRendererPuppeteerClientFeature` | `()` | `()` | same name; the FW feature also registers the `rendered-pdf` entity, the `puppeteer-status` and `preview-pdf` queries and `previewDocument`, which needs the `rendered_pdfs` migration |
| `puppeteerRender` | `document-pdf` takes `payload.content` as raw HTML | `document-pdf` resolves a template from `{ slug, locale, variables }`; `image-snapshot` still takes `payload.content` | different payload |
| `RendererPuppeteerClientQueries` (`/qualified-names`) | absent | present | FW only |
| `RENDERED_PDF_ENTITY_NAME`, `renderedPdfEntity`, `renderedPdfsTable`, `PuppeteerUnavailableError`, `renderPdfBeforeTransaction`, `storeRenderedPdf` and their types | absent | present | FW only |

HTTP client differences:

- Retries: the FW retries only 502 and 503 and network errors. 500 and 504 are final (`other`); the Enterprise client retried every 5xx. This is deliberate.
- Exhausted retries give `unavailable` instead of `other`; a request timeout covers headers and body and is also `unavailable`.
- A missing or invalid client configuration is `unavailable` instead of a raw error.
- The egress pin to the service origin (same-origin redirects only, no bearer token forwarded) is the same in both.

## puppeteer-service

| Protection | Enterprise | FW | Status |
|---|---|---|---|
| Request egress guard | `http`, `https`, `data`, `about`, `blob`; private IP ranges blocked after a DNS lookup | only `data:`, `about:` and `blob:`; every other request is blocked without a lookup | FW stricter, so documents must embed all resources as `data:` |
| Bearer token check | string comparison | SHA-256 plus `timingSafeEqual` | FW stronger |
| PDF margins | positive numbers, no upper limit | 0 to 100 | FW stricter |
| `landscape` option | absent | present | FW only |
| Body size limit, JavaScript off, render timeout, minimum token length | present | present | same |
