---
status: reference
verified: 2026-10-19
evidence: "packages/*/package.json (23 directories, none private); shim re-exports under packages/{headless,dispatcher-live,renderer-web,http,repo-manifest}/src; codemod in packages/framework/src/scripts/codemod/package-merge.ts"
---

# Package set

The framework repo holds 23 package directories. 18 of them are real packages and 5 are
deprecated re-export shims that exist only for one migration wave. Wave 3 folds the shim
packages into their target packages. This page lists the set as it stands after the fold.

## Real packages (18)

| Package | Purpose |
| --- | --- |
| `@cosmicdrift/kumiko-framework` | Engine, pipeline, API, DB, event store; subpath `/http` is the SSRF-safe egress client |
| `@cosmicdrift/kumiko-types` | Engine and DB type contracts without the runtime |
| `@cosmicdrift/kumiko-bundled-features` | Ready-made features (tenant, user, auth, files, billing, jobs and more) |
| `@cosmicdrift/kumiko-cli` | The `kumiko` CLI commands |
| `@cosmicdrift/kumiko-dev-server` | Dev server, `kumiko-schema`, `kumiko-upgrade`, `kumiko-build` |
| `create-kumiko-app` | `bun create kumiko-app` scaffolding and the feature manifest |
| `@cosmicdrift/kumiko-server-runtime` | Production boot: connections, schema-drift gate, lifecycle |
| `@cosmicdrift/kumiko-testing` | Test stack, seeding, preloads, integration runner |
| `@cosmicdrift/kumiko-guards` | AST guards and repo checks; subpath `/repo-manifest` is the `kumiko.json` schema and loader |
| `@cosmicdrift/kumiko-renderer` | Platform-agnostic renderer; subpaths `/headless/*` (UI logic, dispatcher contract), `/live` (HTTP dispatcher) and `/web/*` (web bindings) |
| `@cosmicdrift/kumiko-renderer-mail-html` | Mail HTML rendering |
| `@cosmicdrift/kumiko-renderer-puppeteer-client` | Client for the PDF and image rendering service |
| `@cosmicdrift/kumiko-document-designer` | Template editor; stays its own package because apps mount it |
| `@cosmicdrift/kumiko-locale-de` | Opt-in UI and mail copy (German) |
| `@cosmicdrift/kumiko-locale-es` | Opt-in UI and mail copy (Spanish) |
| `@cosmicdrift/kumiko-locale-fr` | Opt-in UI and mail copy (French) |
| `@cosmicdrift/kumiko-locale-it` | Opt-in UI and mail copy (Italian) |
| `@cosmicdrift/kumiko-samples` | Packaged source of recipes and sample apps |

## Deprecated shims (5)

Each shim re-exports its target and is removed after wave 4.

| Shim | Moved to |
| --- | --- |
| `@cosmicdrift/kumiko-headless` | `@cosmicdrift/kumiko-renderer/headless/*` |
| `@cosmicdrift/kumiko-dispatcher-live` | `@cosmicdrift/kumiko-renderer/live` |
| `@cosmicdrift/kumiko-renderer-web` | `@cosmicdrift/kumiko-renderer/web/*` |
| `@cosmicdrift/kumiko-http` | `@cosmicdrift/kumiko-framework/http` |
| `@cosmicdrift/kumiko-repo-manifest` | `@cosmicdrift/kumiko-guards/repo-manifest` |

Migrate with the codemod, which rewrites imports and the `package.json` dependency:

```bash
bun kumiko codemod package-merge . --write
```

`bun kumiko-upgrade --apply` runs it as part of an upgrade. The codemod is described in
`packages/framework/src/scripts/codemod/README.md`.

## Apps and samples

`apps/puppeteer-service` is the PDF and image rendering service. `samples/recipes/*` hold one
tested example per concept, `samples/apps/*` full sample apps; neither is published as its own
package.
