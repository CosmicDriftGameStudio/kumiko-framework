---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Production builds discovered multi-entry client bundles by scanning `src/` for files matching `client-<suffix>.tsx` — any file matching that pattern became its own bundle, even a plain module only imported by another entry (#2305). `buildProdBundle` now takes the entry list explicitly, the same shape the dev server already uses: package.json `"kumiko": { "clientEntries": [{ "name", "sourceFile", "htmlPath"? }] }` for multi-entry apps, or `"kumiko": { "clientEntry": "./src/…" }` for a single non-conventional entry. Apps with a plain `src/client.tsx` need no declaration. An app that still has `src/client-<suffix>.tsx` files but no `kumiko.clientEntries` declaration now fails the build loudly with the exact snippet to add, instead of silently shipping without those bundles.

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: buildProdBundle takes client entries explicitly via package.json "kumiko.clientEntries"/"kumiko.clientEntry" — no more filename inference
detail: |
  `discoverClientEntries(cwd)`, which scanned `src/` for
  `client-<suffix>.tsx` files and treated every match as its own bundle
  entry, is replaced by `resolveClientEntries(cwd, declared)` plus
  `readClientEntriesConfig(cwd)`, a boundary parser for package.json
  `kumiko.clientEntry` / `kumiko.clientEntries`. `buildProdBundle(options)`
  now accepts the same `clientEntry`/`clientEntries` shape directly.

  `kumiko.clientEntries` entries are validated: `name` must match
  `^[a-z][a-z0-9-]*$` (it becomes the output filename), `sourceFile` (and
  `htmlPath`, if set) must resolve inside the app root, `sourceFile` must
  exist, and names/html-output-files/source-basenames must be unique
  across the list. `clientEntry` and `clientEntries` are mutually
  exclusive; an empty `clientEntries` array is rejected (omit the key
  instead). Apps with only `src/client.tsx` or `src/client.ts` need no
  declaration — that convention is unchanged.
migration: |
  Apps with `src/client-<name>.tsx` entries: add the entry list to
  package.json, using the same objects already passed to
  `runDevApp`/`createKumikoServer`'s `clientEntries` (paths relative to the
  app root). Without this, the build now throws instead of silently
  building without those bundles.

    publicstatus:

      "kumiko": {
        "clientEntries": [
          { "name": "public", "sourceFile": "./src/client-public.tsx" },
          { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
          { "name": "auth", "sourceFile": "./src/client-auth.tsx", "htmlPath": "./public/auth.html" }
        ]
      }

    show-pony:

      "kumiko": {
        "clientEntries": [
          { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
          { "name": "public", "sourceFile": "./src/client-public.tsx", "htmlPath": "./public/index.html" }
        ]
      }

    offlot-app:

      "kumiko": {
        "clientEntries": [
          { "name": "app", "sourceFile": "./src/client-app.tsx", "htmlPath": "./public/app.html" }
        ]
      }

  Apps using a single entry that isn't `src/client.tsx`: add
  `"kumiko": { "clientEntry": "./src/…" }` instead.

  Apps with only `src/client.tsx` | `src/client.ts`: no action needed.

  `discoverClientEntries` (exported from
  `@cosmicdrift/kumiko-dev-server/build`) is removed; callers use
  `resolveClientEntries(cwd, readClientEntriesConfig(cwd))`.
-->

<!-- kumiko-changes
feature: dev-server
type: breaking
title: kumiko-build reads client entries from package.json "kumiko.clientEntries"/"kumiko.clientEntry" instead of inferring them from filenames
detail: |
  `kumiko-build` (and the `kumiko build` command) now call
  `readClientEntriesConfig(cwd)` and pass the result into
  `buildProdBundle`, instead of relying on `discoverClientEntries`'
  filename-based multi-entry discovery. `@cosmicdrift/kumiko-dev-server/build`
  re-exports `resolveClientEntries`, `readClientEntriesConfig`, and
  `ClientEntryDeclaration` in place of `discoverClientEntries`.
migration: |
  See the `@cosmicdrift/kumiko-server-runtime` changelog entry above for
  the required package.json changes — the dev-server change is the CLI
  wiring for the same underlying behavior.
-->
