---
"@cosmicdrift/kumiko-dev-server": minor
---

`scaffoldApp` now produces a bootable app out of the box. Three bugs the
fresh-scaffold smoke uncovered after `bun create kumiko-app demo --yes &&
cd demo && bun install && bun dev`:

- **`/client.js` 404 → blank SPA**: the default HTML referenced
  `/client.js` but `bin/dev.ts` never set `clientEntry`, so the dev-server
  had no bundle to serve. Scaffold now writes `src/client.tsx` (with
  `createKumikoApp({ shell: DefaultAppShell, clientFeatures:
  [emailPasswordClient()] })`) and wires `clientEntry: "./src/client.tsx"`
  into `bin/dev.ts`. `@cosmicdrift/kumiko-renderer-web` is added as a
  scaffolded dependency.
- **`Missing required env var: TEST_DATABASE_URL`**: `runDevApp →
  setupTestStack` required `TEST_DATABASE_URL` but the template only
  listed `DATABASE_URL` (which `runProdApp` needs). `.env.example` now
  carries both with their respective comments.
- **`[composeFeatures] "user/tenant/config/auth-email-password" already
  auto-mounted` spam on every boot**: PR #599 stopped the
  `createRegistry` crash; this PR stops the warns at the source.
  `renderRunConfig` filters those four `composeFeatures`-auto-mounted
  feature names out of the generated `APP_FEATURES` even if the
  create-kumiko-app picker handed them in.

Drive-by: new `e2e/hero-demos/` Playwright suite — scaffolds a fresh app
via `runCreate()` (HEAD code), `bun install`s the published deps, boots
it, and replays a shared `DemoDef` against the live app (the same object
`scripts/record-demo.ts` consumes for the hero GIF). Steps marked
`recordingOnly: true` (typing a new feature into `src/features/`) ship in
the recording but the E2E runner skips them. A green E2E guarantees a
hang-free recording session.
