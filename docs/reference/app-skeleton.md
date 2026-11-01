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
  that call `r.adoptsBundledLists()` (the bundled features with lists);
  `kumiko/schema.ts` passes it to `composeFeatures`, the bin files pass it to
  the runners. See `renderer-widget-options.md`.

- `apiDocs` configures `kumiko api-docs` (below).

Until an app calls `defineAppConfig`, the `managed` and `scripts` steps of
`kumiko check` only warn.

## API docs

An app that mounts `personal-access-tokens` can generate its API documentation:
`kumiko api-docs [--out <dir>] [--locales en,de] [--check]` writes Markdown pages
(overview, tokens, one reference page per token scope), `openapi.json` and
`index.json` to `api-docs/`. Only handlers that a token scope reaches appear.
`--check` writes nothing and prints each problem and each missing, changed or
extra file as `[kind] detail`; it exits 1 if it finds anything, so it fits a CI
step. Exclude the output directory from Biome: a formatter would rewrite the generated
files and `--check` would then report them as changed. Known gap: the check for screen writes outside the scopes only looks at features
that have at least one handler in a scope, so a domain with no scope entry at all is not
reported. The command mounts the bundled features only with `includeBundled: true`, so
an app that needs `auth-foundation` for the token feature lists it in `features`.

`apiDocs` in `kumiko.config.ts` takes:

- `baseUrl` (required) and `appName`, used in the curl examples and the OpenAPI file.
- `locales` (`en`, `de`, `es`, `fr`, `it`; default `en`) and `outDir`.
- `planNote`, one paragraph per locale appended to the tokens page.
- `webhookDelivery`, one paragraph per locale for the delivery section of `events.md`. Required for every locale once a scope lists `events`; signing, retries and timeouts are the app's own.
- `uiOnlyWrites`, patterns of writes that screens trigger but no scope grants, each
  with a `reason`; unlisted ones are reported.
- `texts`, paragraph overrides per locale and key; the page structure stays fixed.
- `examplesDir` (default `api-examples`), recorded request and response pairs. Record
  them in an integration test with `recordApiExample` from
  `@cosmicdrift/kumiko-testing/api-examples` and `KUMIKO_RECORD_API_EXAMPLES=1`.

A scope's `events` list its public webhook events (exact names, read level suffices): a
contract from `r.defineWebhookEvent({ name, description, payload, version })` or an entity
event such as `ticket.created`, whose contract is derived from the entity without personal
fields and without the CRUD `excludedFields`. Entity events exist only for entities that set
`webhookEvents: true`; without it the entity releases nothing and boot fails for its events.
`defineWebhookEvent` takes an optional `wireName`, the name receivers see in the delivered
webhook (default: `name`); the generated docs use it. Handlers with `access.roles: ["system"]`
are left out of the docs even when a scope pattern matches them. Internal `r.defineEvent` events are never
listed; boot fails for them. `events.md` and the `webhooks` section of `openapi.json` appear
only when an event is public. Record example payloads with `recordWebhookExample` from the
same testing entry; it validates through `parseWebhookPayload` and writes
`<examplesDir>/webhooks/<name>.json`. Delivery itself (signing, retries) stays in the app.
`toEntityWebhookPayload(contract, storedEvent)` builds the payload of an entity event (with
the `id`) and drops everything the contract does not release. Known gap: `money` and
`locatedTimestamp` fields are left out of derived entity contracts, because their event shape
(several flat columns) is not mapped yet.
Derived entity contracts never release credentials (hashes, tokens, secrets), client IPs and user
agents, storage keys, fields with restricted read access, or system-written plaintext fields.

The recipe `samples/recipes/api-docs` shows the whole loop with a committed golden.

## Script standard

`kumiko check scripts` requires these `package.json` scripts: `dev`, `build`,
`start`, `typecheck`, `lint`, `check`, `test`, `test:unit`, `test:integration`,
`test:integration:ci`, `test:dom` (only with `uiRoots`), `test:real`, `e2e`,
`e2e:real`, `screenshots`, `prepare`. `test:verbose`, `test:bunfig`,
`test:lib-coverage` and `shots` are listed as known extras, everything else as app
extras.
