# PDF Letterhead

A PDF layout with its own look, a letter with an address frame, and the transfer of the layout to templates.

## What it shows

- A system `pdf-layout` with a header, a footer in three columns (a borderless table) that prints the company placeholders `companyAddress`, `companyIban` and `companyBic`, and appearance in `meta`: font, size, table style and page margins in mm.
- A `document-pdf` letter with an address frame (`data-frame`, preset `address`) at the DIN 5008 form B window position, and a text style (`data-text-style`) on a run of text.
- Company placeholders read the tenant's own settings (`tenant:config:company-*`); the validate query lists the ones a tenant has left empty.
- `apply-layout` hands the layout to chosen templates as drafts (mode `selected`) or makes it the tenant default (mode `all`, no copies); `publish-templates` activates the drafts together; the usage query lists which templates use the layout.

## Source

`src/letterhead.ts` holds the layout, the letter and the tenant-editable list; the app passes the list to `createTemplateResolverFeature({ tenantEditable })`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/pdf-letterhead
bun test
```
