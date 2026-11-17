---
status: reference
verified: 2026-11-17
evidence: "packages/*/package.json (15 directories, none private); .changeset/config.json fixed group"
---

# Package set

The framework repo holds 15 package directories, all released in one lockstep version
group (`.changeset/config.json`). The five former re-export shims and the French and Italian locale packages are gone; this
page lists what replaces them.

## Real packages (15)

| Package | Purpose |
| --- | --- |
| `@cosmicdrift/kumiko-framework` | Engine, pipeline, API, DB, event store; subpath `/http` is the SSRF-safe egress client |
| `@cosmicdrift/kumiko-types` | Engine and DB type contracts without the runtime |
| `@cosmicdrift/kumiko-bundled-features` | Ready-made features (tenant, user, auth, files, billing, jobs and more), including the mail HTML renderer (`/renderer-mail-html`) and the PDF and image print client (`/renderer-puppeteer-client`) |
| `@cosmicdrift/kumiko-feature-ast` | Feature-file AST (parse, patch, render), the pattern library and the codemods a guard points to; subpath `/codemod` is the Bun-only codemod pipeline |
| `@cosmicdrift/kumiko-cli` | The `kumiko` CLI commands and `kumiko-upgrade` |
| `@cosmicdrift/kumiko-dev-server` | Dev server, `kumiko-dev`, `kumiko-schema`, `kumiko-build` |
| `create-kumiko-app` | `bun create kumiko-app` scaffolding and the feature manifest |
| `@cosmicdrift/kumiko-server-runtime` | Production boot: connections, schema-drift gate, lifecycle |
| `@cosmicdrift/kumiko-testing` | Test stack, seeding, preloads, integration runner |
| `@cosmicdrift/kumiko-guards` | AST guards and repo checks; subpath `/repo-manifest` is the `kumiko.json` schema and loader |
| `@cosmicdrift/kumiko-renderer` | Platform-agnostic renderer; subpaths `/headless/*` (UI logic, dispatcher contract), `/live` (HTTP dispatcher) and `/web/*` (web bindings) |
| `@cosmicdrift/kumiko-document-designer` | Template editor; stays its own package because apps mount it |
| `@cosmicdrift/kumiko-locale-de` | Opt-in UI and mail copy (German) |
| `@cosmicdrift/kumiko-locale-es` | Opt-in UI and mail copy (Spanish) |
| `@cosmicdrift/kumiko-samples` | Packaged source of recipes and sample apps |

## Removed packages (7)

These names are no longer published. Shim code lives in the target package; the two locale packages had no consumer and were deleted.

| Removed package | Moved to |
| --- | --- |
| `@cosmicdrift/kumiko-headless` | `@cosmicdrift/kumiko-renderer/headless/*` |
| `@cosmicdrift/kumiko-dispatcher-live` | `@cosmicdrift/kumiko-renderer/live` |
| `@cosmicdrift/kumiko-renderer-web` | `@cosmicdrift/kumiko-renderer/web/*` |
| `@cosmicdrift/kumiko-http` | `@cosmicdrift/kumiko-framework/http` |
| `@cosmicdrift/kumiko-repo-manifest` | `@cosmicdrift/kumiko-guards/repo-manifest` |
| `@cosmicdrift/kumiko-locale-fr` | none; generate a locale package by AI translation of the English catalog when an app needs French |
| `@cosmicdrift/kumiko-locale-it` | none; generate a locale package by AI translation of the English catalog when an app needs Italian |

Replace the imports and the `package.json` dependency per the table.

## Apps and samples

`apps/puppeteer-service` is the PDF and image rendering service. `samples/recipes/*` hold one
tested example per concept, `samples/apps/*` full sample apps; neither is published as its own
package.
