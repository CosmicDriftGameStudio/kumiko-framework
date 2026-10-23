---
status: reference
verified: 2026-10-18
evidence: "kumiko new app scaffold, packages/dev-server/src/managed-files/registry.ts, kumiko check managed|scripts"
---

# App skeleton

`kumiko new app <name>` (and `bun create kumiko-app`) writes the files below. The
"Owner" column says who changes a file afterwards:

- **managed**: the framework. Line 1 (line 2 after a `#!` or `# syntax=` line)
  reads `# kumiko-managed` or `// kumiko-managed`. `kumiko check managed` compares
  the file against the template of the installed framework version and prints a
  diff; `kumiko sync-managed --write` restores it.
- **preset**: the app, but the file must extend the framework preset. App
  overrides next to `extends` are allowed.
- **seed**: written once by the scaffold, then owned by the app. The check only
  reports a missing file.
- **app**: the app, never checked.

| Path | Owner | Content |
| --- | --- | --- |
| `deploy/Dockerfile`, `deploy/Dockerfile.dockerignore` | managed | Container build; migrations run as the k3s InitContainer from `release.yml`. `deploy/migrate-step.sh` is not managed (compose self-hosting only, from `kumiko-init-deploy`) |
| `.github/workflows/ci.yml` | managed | Test, integration, e2e and image build via the shared workflows |
| `.github/workflows/release.yml` | managed | Manual rollout of a built image |
| `.github/workflows/cache-cleanup.yml` | managed | Removes PR caches after merge |
| `.husky/pre-push` | managed | Pre-push hook; app additions go to `scripts/pre-push-extra.sh` |
| `bunfig.toml`, `bunfig.integration.toml`, `bunfig.real.toml`, `bunfig.dom.toml` | managed | Test configs; `bunfig.dom.toml` only with `uiRoots`. Extra sections such as `[install.scopes]` survive the sync |
| `kumiko/schema.ts` | managed | `FEATURES` and `ENTITY_METAS` derived from `kumiko.config.ts` |
| `biome.json` | preset | `{ "extends": ["@cosmicdrift/kumiko-framework/biome"] }` |
| `tsconfig.json` | preset | `extends: "@cosmicdrift/kumiko-framework/tsconfig.app.json"` |
| `kumiko.config.ts` | preset | `defineAppConfig(...)`, see below |
| `bin/server.ts` | seed | Dev server (`runDevApp`) |
| `bin/env-schema.ts` | seed | Env contract of the production processes |
| `bin/main.ts`, `bin/kumiko.ts` | app | Production boot, bundled schema and consumer CLI |
| `src/run-config.ts`, `src/features/`, `src/client.tsx` | app | Features and the web entry |
| `e2e/_helpers/`, `src/__tests__/_setup.ts` | app | Shared e2e helpers and integration stack setup |
| `kumiko.json` | app | Repo manifest: kind, source roots, `uiRoots` |

A deliberate change to a managed file stays when line 2 reads
`# kumiko-managed: local <reason>`. The check then skips the file and lists it
with the reason; the sync leaves it alone. A file without any marker is never
overwritten unless `kumiko sync-managed --write --adopt` is passed.

## kumiko.config.ts

```ts illustration
import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";

export default defineAppConfig({
  features: composeFeatures([...APP_FEATURES], { includeBundled: HAS_AUTH }),
  prodFeatures: [createFileProviderS3Feature({ fromEnv: true })], // optional, production only
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4173, e2e: 4174, infra: { postgres: 15440, meilisearch: 17710 } },
});
```

- `features` plus `prodFeatures` is the list `kumiko/schema.ts`, `kumiko agent lint`
  and the boot check see.
- `ports` must be number literals: `kumiko check managed` and `kumiko ports` read
  them without running the file. `kumiko ports [workspace-root]` lists every app
  below the root and fails on a port claimed twice, infrastructure ports included.
- `ports.infra.s3` and `ports.infra.meilisearch` switch the MinIO and Meilisearch
  services on in the managed `ci.yml`.
- `bundledLists` sets one DataTable `table` block for every list of the features
  that call `r.adoptsBundledLists()` (the bundled features with lists); `kumiko/schema.ts` passes it to `composeFeatures`, the bin files pass
  it to the runners. See `renderer-widget-options.md`.

Until an app calls `defineAppConfig`, the `managed` and `scripts` steps of
`kumiko check` only warn.

## Script standard

`kumiko check scripts` requires these `package.json` scripts: `dev`, `build`,
`start`, `typecheck`, `lint`, `check`, `test`, `test:unit`, `test:integration`,
`test:integration:ci`, `test:dom` (only with `uiRoots`), `test:real`, `e2e`,
`e2e:real`, `screenshots`, `prepare`. `test:verbose`, `test:bunfig`,
`test:lib-coverage` and `shots` are listed as known extras, everything else as app
extras.
