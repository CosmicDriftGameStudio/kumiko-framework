---
status: reference
verified: 2026-11-16
evidence: "generated from packages/guards/src/{guard,check}-*.ts and packages/framework/presets/biome-rules.json + biome-plugins/*.grit by scripts/gen-guards-doc.ts; drift is enforced by the guards-doc-drift check"
---

# Guards

Generated, do not edit. Run `bun run gen:guards-doc` after adding or changing a guard.
Purpose is the first sentence of the guard's header comment; the suppression column lists
the `kumiko-lint-ignore <key>` markers the guard honors (`-` = not suppressible inline).
A marker that suppresses nothing in a run fails the `unused-ignore-tags` check; delete it.

| Guard | Purpose | Suppression |
| --- | --- | --- |
| `check-as-casts` | `as X` cast audit with a baseline regression gate (fails on regressions). | - |
| `check-complexity` | Complexity check for .ts and .tsx hotspots with a hard cap and a baseline regression guard. | `kumiko-lint-ignore complexity-budget` |
| `check-licenses` | Licence check over the installed third-party packages of ONE repo. | - |
| `check-outdated` | Deprecated-dependency check over ONE repo. | - |
| `check-real-provider-isolation` | Real-Provider-Isolation-Guard (stack-agnostic). | - |
| `check-runtime-isolation` | Runtime-Isolation Guard. | - |
| `check-secret-literals` | Secret-literal guard (stack-agnostic). | `kumiko-lint-ignore secret-literal` |
| `check-security` | Security check: `bun audit` over the lockfile of ONE repo. | - |
| `check-single-runtime-instance` | Single-Runtime-Instance Guard. | - |
| `check-subpath-exports` | A published package that ships `src/<feature>/web.ts` must list `./<feature>/web` in its package.json `exports`; otherwise every standalone app build fails with "Could not resolve". | - |
| `guard-agent-docs-drift` | Guard: the generated agent docs under `packages/framework/agents/` must match what `bun run gen:agent-docs` renders from the current sources (feature manifest, public entry-point signatures, renderer web exports, sample recipes), and every `agents/<file>.md` path the hand-written `packages/framework/AGENTS.md` points at must exist in that generated set. | - |
| `guard-app-dockerfile` | An app's `deploy/Dockerfile` must reach the private @cosmicdriftgamestudio registry through a BuildKit secret, never through an NPM_AUTH_TOKEN build-arg that lands in the image history. | - |
| `guard-app-feature-structure` | App features follow the bundled-features convention (reference: tenant/): feature.ts = registration only, screens under web/, handlers under handlers/. | `kumiko-lint-ignore app-feature-structure` |
| `guard-biome-preset` | - | - |
| `guard-comment-issue-ref-only` | Comment Issue-Ref Guard: a comment that holds only an issue or PR reference or a planning label (`#1234`, `fw#1234`, `Phase 3`, `S2.H1`) and no explanatory word is a violation. | `kumiko-lint-ignore comment-issue-ref-only` |
| `guard-comment-lang` | Comment-language ratchet: no new German comments in product code. | `kumiko-lint-ignore comment-lang` |
| `guard-cross-feature-imports` | Guard: blocks cross-feature deep imports. | `kumiko-lint-ignore cross-feature-import` |
| `guard-data-testid` | Data-Testid Guard — `data-testid` / `data-test` hooks in production code are frozen per file in `.kumiko-data-testid-baseline.json` and may not grow; tests select by role, label or text (workspace decision 2026-09-22 "no test hooks in production code"). | - |
| `guard-direct-entity-writes` | Guard: forbids direct DB writes on tables registered as ES-entity projections. | - |
| `guard-doc-status` | Every doc under docs/{plans,runbooks,migration,reference} needs valid status frontmatter. | - |
| `guard-fake-tests` | Guard: tests must actually assert something. | - |
| `guard-feature-import-cycles` | Feature Import Cycles Guard — counts static runtime imports that close a cycle between two or more features, frozen per file in `.kumiko-feature-import-cycles-baseline.json`. | - |
| `guard-feature-integration-tests` | Guard: every feature in packages/bundled-features/src/<name>/feature.ts must be imported by at least one *.integration.ts. | - |
| `guard-file-size` | File Size Guard — production files above 1200 lines and test files (unit, integration, e2e specs) above 1500 lines are frozen in `.kumiko-file-size-baseline.json` (key = file, value = line count) and may not grow; a new file above its threshold is a violation. | - |
| `guard-guards-doc-drift` | Fails when docs/reference/guards.md differs from what the generator renders from the guard sources. | - |
| `guard-handler-definitions` | Handler Definitions Guard — counts handler definitions that break the one-handler-per-file layout under `handlers/` or erase their payload type, frozen per file in `.kumiko-handler-definitions-baseline.json`. | - |
| `guard-html-escape` | Guard: HTML-building template literals must escape every interpolation. | - |
| `guard-i18n-keys` | Guard: i18n keys must be defined before they are used. | - |
| `guard-i18n-locale-mount` | Guard: app mount points must register the German locale feature when the repo depends on @cosmicdrift/kumiko-locale-de. | - |
| `guard-i18n-ui-strings` | No hardcoded UI text in app web code: JSX text nodes and label-like string props must go through t("…") keys (guard-i18n-keys then checks that the keys are defined — this guard closes the gap before that: strings that never became keys, e.g. "Loading tenants…"). | `kumiko-lint-ignore i18n-ui-strings` |
| `guard-ignore-tag-reason` | Ignore-Tag-Reason Guard: every `kumiko-lint-ignore <slug> <reason>` (or file-wide `kumiko-lint-ignore-file <slug> <reason>`) and `biome-ignore[-all\|-start] <rule>: <reason>` comment states a real reason. | - |
| `guard-import-extensions` | Guard: relative imports in TypeScript sources name the source file (`./foo.ts`), not the emitted one (`./foo.js`). | - |
| `guard-integration-mocks` | Integration-Mocks Check — integration tests run against the real stack, so mock calls (`mock(`, `spyOn(`, `mock.module`, `vi.*`, `jest.*`) in `*.integration.test.ts` / `*.integration.ts` are frozen per file in `.kumiko-integration-mocks-baseline.json` and may not grow. | - |
| `guard-internal-subpath-imports` | Guard: keeps the row-level-security escape hatches out of consumer code. | - |
| `guard-lib-test-coverage` | lib/ is the home of extracted logic (computation, parsing, mapping) — the no-logic-in-views guard pushes it there, this guard ensures it is also TESTED at the new location. | - |
| `guard-no-framed-extension-sections` | Extension-section components (registered via a ClientFeatureDefinition's `extensionSectionComponents`) are mounted inside RenderEdit's own section frame (Section in standalone screens, Card in tabs mode — see render-edit.tsx). | `kumiko-lint-ignore no-framed-extension-sections` |
| `guard-no-logic-in-views` | web/ contains components and hooks — computation, parsing and aggregation belong in lib/ (with a test). | `kumiko-lint-ignore no-logic-in-views` |
| `guard-public-exports-changelog` | Public exports of packages/framework and packages/bundled-features must not disappear (rename/removal) without a breaking changelog entry. | - |
| `guard-raw-sql` | Raw-SQL Guard — blocks `.unsafe()` / `asRawClient()` outside allowed paths. | `kumiko-lint-ignore raw-sql` |
| `guard-renderer-boundaries` | Guard: prevents `@cosmicdrift/kumiko-renderer` (shared, platform-neutral) from touching DOM- or platform-specific APIs. | - |
| `guard-rls-session-settings` | Guard: row-level-security settings are transaction-local and written in one place. | - |
| `guard-schema-cli-features` | Guard: a consumer's `runSchemaCli(...)` call must pass `features: FEATURES` imported from `kumiko/schema`. | - |
| `guard-screen-conventions` | Usability mistakes in screen definitions that are statically decidable and otherwise come back screen by screen: a relatedList section whose rows lead nowhere, a row action labelled "edit" that does something else. | `kumiko-lint-ignore screen-conventions` |
| `guard-security-plugin-suppression` | Security-Plugin-Suppression Guard: `// biome-ignore lint/plugin: <reason>` must not silence the security Biome plugins (admin API, event-store literal writes, restricted event-store symbols, direct fs, server-side direct fetch). | - |
| `guard-seed-runtime-imports` | Seed-Runtime-Imports Guard — files under an app's `seeds/` run in the runtime image, which ships `seeds/` without `src/` and bundles the `@cosmicdrift` packages into server.js without installing them (packages/dev-server/templates/deploy/Dockerfile.template, runtime stage). | - |
| `guard-tailwind-scan-surface` | Guard: `className` string-literal tokens under kumiko-framework's `packages/bundled-features/src/**` must already be reachable through the real Tailwind `@source` scan surface (`packages/renderer/src` + `samples/**\/src`, see `packages/renderer/src/web/styles.css`). | `kumiko-lint-ignore tailwind-scan-surface` |
| `guard-tenant-escalation` | Guard: tenant / privilege-escalation safety. | - |
| `guard-test-env-writes` | Test-Env-Writes Guard — direct writes to `process.env` / `Bun.env` in tests are frozen per file in `.kumiko-test-env-writes-baseline.json` and may not grow; tests set env through `withEnv`, `withEnvForEachTest` or `withEnvForSuite` so the previous value is always restored. | - |
| `guard-test-es-row-writes` | Guard: framework tests do not write event-sourced rows through the seed bypass. | - |
| `guard-test-stack-drift` | Guard: *.integration.ts / *.integration.test.ts files must not construct a parallel server stack. | - |
| `guard-test-template-drift` | Guard: apps must not locally reimplement the e2e/screenshot template that `@cosmicdrift/kumiko-testing` already owns. | `kumiko-lint-ignore test-template-drift` |
| `guard-test-timeouts` | Guard: tests wait for a condition, not for time. | `kumiko-lint-ignore test-timeouts` |
| `guard-unsafe-array-param` | Warns when a `.unsafe(sql, [...])` parameter list holds a JS array literal. | - |
| `guard-upgrade-state` | Guard: a consumer repo's `.kumiko/upgrade-state.json` marker must be caught up with the installed Kumiko framework version. | - |
| `guard-weak-assertions` | Weak-Assertions Guard — tests whose only assertions are `expect(x).toBeDefined()` or `expect(x).toBeTruthy()` are counted per file in `.kumiko-weak-assertions-baseline.json` and may not grow; such a test passes for any value that happens to exist. | - |
| `guard-write-handler-qns` | Guard: checks that `dispatcher.write("qn:literal:...")` calls in custom screens reference valid write-handler QNs. | - |

## Biome plugins

Generated from `packages/framework/presets/biome-rules.json`. Purpose is the first sentence of the plugin's first diagnostic. Suppress a single finding with `biome-ignore lint/plugin: <reason>`; the security plugins (see the `security-plugin-suppression` guard) are not suppressible.

| Plugin | Purpose | Scope |
| --- | --- | --- |
| `admin-api` | Admin API (appendRaw/appendRawBatch) bypasses the pipeline and is only allowed in samples/*/migration/, scripts/migrations/ and the event-store admin-api itself. | `**/*.ts` |
| `error-reasons` | Error reason must be snake_case ASCII with optional dot namespaces (^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$): clients key off it across wire, logs and i18n. | `**/src/**/*.ts`, `**/bin/**/*.ts`, `**/scripts/**/*.ts` |
| `es-literal-writes` | Raw SQL write on an event-store table (kumiko_events, kumiko_snapshots, kumiko_archived_streams) or hand-written read_tenant_memberships DDL. | `**/src/**/*.ts`, `**/bin/**/*.ts`, `**/scripts/**/*.ts` |
| `es-literal-writes-tests` | Raw INSERT/UPDATE on kumiko_events or hand-written read_tenant_memberships DDL in a test. | `**/__tests__/**/*.ts`, `**/*.test.ts`, `**/*.integration.ts` |
| `i18n-locale-terminology-de` | German locale terminology: use Mandant instead of Tenant/Organisation (fw#2200). | `**/packages/locale-de/src/strings.ts` |
| `i18n-locale-terminology-romance` | Locale terminology: use Organización (es), organisation (fr) or organizzazione (it) instead of the tenant loanword (fw#2200). | `**/packages/locale-es/src/strings.ts`, `**/packages/locale-fr/src/strings.ts`, `**/packages/locale-it/src/strings.ts` |
| `no-create-test-dispatcher` | Integration tests run through the real stack: use setupTestStack from @cosmicdrift/kumiko-testing/stack and stack.http.writeOk/queryOk, never createTestDispatcher. | `**/*.integration.ts`, `**/*.integration.test.ts` |
| `no-css-properties-type` | CSSProperties style objects bypass theme tokens and dark mode. | `**/*.ts`, `**/*.tsx` |
| `no-date-api` | JS Date API in production code: use Temporal.Now.instant(), Temporal.Instant.from(...), .toString() or .epochMilliseconds (ctx.tz for wall-clock + IANA zone). | `**/src/**/*.ts`, `**/bin/**/*.ts`, `**/scripts/**/*.ts` |
| `no-direct-fetch` | Raw fetch() skips the SSRF policy in server code: use egress(policy)(...) from @cosmicdrift/kumiko-framework/http. | `**/src/**/*.ts`, `**/bin/**/*.ts`, `**/scripts/**/*.ts`, `**/web/**/*.tsx`, `**/public/**/*.tsx` |
| `no-direct-fs` | Direct fs import: request-derived paths passed straight to fs caused path-traversal bugs. | `**/src/**/*.ts` |
| `no-external-font-cdn` | No external font CDNs (fonts.googleapis.com, fonts.gstatic.com): self-host fonts so no visitor data leaves for a third party. | `**/src/**/*.ts`, `**/src/**/*.tsx` |
| `no-external-font-cdn-css` | No external font CDNs (fonts.googleapis.com, fonts.gstatic.com): self-host fonts so no visitor data leaves for a third party. | `**/*.css` |
| `no-raw-hooks` | Raw useEffect/useLayoutEffect in web screens is the source of endless-rerender bugs and bypasses the framework hooks. | `**/web/**/*.tsx`, `**/public/**/*.tsx` |
| `no-same-folder-barrel-import` | Import siblings directly (./Component), not through the folder's own barrel: barrel-importing from inside the same folder creates require cycles. | `**/src/**/*.ts`, `**/src/**/*.tsx` |
| `no-screen-container-classes` | Screen container classes (mx-auto + max-w-*) belong in <PageSection maxWidth> (3xl/4xl/full), not in screen code. | `**/web/**/*.tsx`, `**/client/**/*.tsx` |
| `no-skipped-or-retried-tests` | Unconditionally skipped test. | `**/__tests__/**/*.ts`, `**/__tests__/**/*.tsx`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.integration.ts`, `**/e2e/**/*.ts` |
| `no-temporal-polyfill-require` | temporal-polyfill loaded by require()/import(): import { Temporal } from "@cosmicdrift/kumiko-types/temporal" instead — it prefers the native global, so framework and consumer share one set of Temporal classes. | `**/*.ts`, `**/*.tsx` |
| `raw-html-in-web` | Raw HTML element in web code: use the framework primitives (usePrimitives(): DataTable, Form, Button, DefaultDialog) instead of table/form/button/dialog. | `**/web/**/*.tsx`, `**/client/**/*.tsx`, `**/public/**/*.tsx` |
| `raw-ui-in-app` | Raw form element in app code: use the framework primitives (usePrimitives(): Input via Field, ComboboxInput) instead of input/select/textarea/label. | `**/*.tsx` |
| `restricted-event-store-symbols` | Restricted event-store primitive. | `**/src/**/*.ts`, `**/bin/**/*.ts`, `**/scripts/**/*.ts` |
| `test-title` | Test titles are English and state the behaviour, not an issue or PR number (the number belongs in the commit message). | `**/__tests__/**/*.ts`, `**/__tests__/**/*.tsx`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.integration.ts`, `**/*.e2e.ts`, `**/e2e/**/*.ts` |
| `unsafe-json-parse` | Unguarded JSON.parse throws a SyntaxError on corrupt external input. | `**/src/**/*.ts`, `**/bin/**/*.ts`, `**/scripts/**/*.ts` |
