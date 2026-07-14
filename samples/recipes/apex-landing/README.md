## Screenshot renderer

`bun run screenshot` renders the sample page and shoots a full-page PNG via
Playwright (`page.setContent` — no server, because the renderer is pure). The
spec also paints a product-board mock (`hero-app.png`), uses it in the hero
`.shot-frame`, then writes `lightbox.png` with the overlay open. Docs embed
`screenshots/landing.png` and `screenshots/apex/lightbox.png`.

## GEO/AEO: schema.org JSON-LD

`buildLandingPage`'s `head.schemaJson` combines `organizationSchema` +
`webPageSchema` (from the `seo` feature) into one `@graph` block — Organization
+ WebPage nodes in a single `<script type="application/ld+json">`, which
`renderApexPage` already knows how to emit. This is the seam an app extends
with `faqPageSchema` for an FAQ section, or its own custom schema.org type.

## Site discovery: sitemap.xml / llms.txt

The recipe itself has no server (`renderApexPage` is a pure function — nothing
to boot), but `src/__tests__/seo-routes.integration.test.ts` shows how an app
mounts `createSeoFeature` alongside the thin `GET /` route that serves
`renderLanding(...)`, and exercises `/sitemap.xml` + `/llms.txt` as real HTTP
requests via `setupTestStack`.

## Run

```bash
bun test            # pure-function seams + the seo-mounted integration test
bun run screenshot  # → screenshots/landing.png + lightbox.png
```
