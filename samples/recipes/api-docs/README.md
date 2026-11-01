# API docs

API documentation for personal access tokens, generated from the app itself. A ticketing
feature exposes its ticket handlers through token scopes; `kumiko api-docs` turns the
registry, the translations and recorded requests into Markdown pages, an OpenAPI file and
an `index.json` that a website or an agent can read.

## What it shows

- **Scopes decide the content.** Only handlers that a scope of the token feature reaches
  appear. `ticketing:write:ticket:purge` is reachable from a screen but in no scope, so it is
  listed under `apiDocs.uiOnlyWrites` with a reason; without that entry the generator reports it.
- **Texts come from the feature.** Titles, descriptions and field labels per locale use the
  keys `<handler qn>:title`, `:description` and `:field:<name>`; the German pages need the
  German translations, the menu path to the token screen comes from the nav tree.
- **Examples are recordings.** The integration test sends real requests with a token through
  `recordApiExample` from `@cosmicdrift/kumiko-testing/api-examples`. UUIDs, timestamps and
  tokens are replaced by fixed values, so a recording only changes when the API changes.
- **The output is a golden.** `api-docs/` is committed and the golden test fails when the
  generator would produce something else.

## Commands

Record the examples (writes `api-examples/`, needs Postgres from `docker compose up -d`):

```
KUMIKO_RECORD_API_EXAMPLES=1 bun test --config=bunfig.integration.toml samples/recipes/api-docs/src/__tests__/api-docs.integration.test.ts
```

Regenerate the golden (empties and rewrites `api-docs/`):

```
KUMIKO_UPDATE_API_DOCS_GOLDEN=1 bun test samples/recipes/api-docs/src/__tests__/api-docs.golden.test.ts
```

Both tests run without the flags as ordinary checks.

In an app, `kumiko api-docs` writes the pages to `apiDocs.outDir` (default `api-docs`) and
`kumiko api-docs --check` compares them with the disk, so a CI step can keep them current.
The golden test pins the framework and app version in `index.json` and `openapi.json`, so
those two files differ from a real run of the command.

## Files

```
kumiko.config.ts                          features and the apiDocs block
src/feature.ts                            ticketing feature and the token feature with its scopes
src/__tests__/api-docs.integration.test.ts   mints a token, records the examples, checks scope limits
src/__tests__/api-docs.golden.test.ts        generator output equals api-docs/
api-examples/                             recorded requests and responses
api-docs/                                 the golden output
```
