---
status: reference
verified: 2026-10-20
evidence: "generated from packages/guards/src/{guard,check}-*.ts by scripts/gen-guards-doc.ts; drift is enforced by the guards-doc-drift check"
---

# Guards

Generated, do not edit. Run `bun run gen:guards-doc` after adding or changing a guard.
Purpose is the first sentence of the guard's header comment; the suppression column lists
the `kumiko-lint-ignore <key>` markers the guard honors (`-` = not suppressible inline).

| Guard | Purpose | Suppression |
| --- | --- | --- |
| `check-as-casts` | `as X` cast audit with a baseline regression gate (fails on regressions). | - |
| `check-complexity` | Complexity check for .ts and .tsx hotspots with a hard cap and a baseline regression guard. | `kumiko-lint-ignore complexity-budget` |
| `check-licenses` | Licence check over the installed third-party packages of ONE repo. | - |
| `check-outdated` | Deprecated-dependency check over ONE repo. | - |
| `check-predicates` | Predicate-extraction check (WARNING, no fail). | - |
| `check-real-provider-isolation` | Real-Provider-Isolation-Guard (stack-agnostic). | - |
| `check-runtime-isolation` | Runtime-Isolation Guard. | - |
| `check-secret-literals` | Secret-literal guard (stack-agnostic). | `kumiko-lint-ignore secret-literal` |
| `check-security` | Security check: `bun audit` over the lockfile of ONE repo. | - |
| `check-single-runtime-instance` | Single-Runtime-Instance Guard. | - |
| `check-subpath-exports` | A published package that ships `src/<feature>/web.ts` must list `./<feature>/web` in its package.json `exports`; otherwise every standalone app build fails with "Could not resolve". | - |
| `guard-admin-api` | Guard: blocks calls to the event-store admin API (`appendRaw`/`appendRawBatch`) outside allowed paths. | - |
| `guard-agent-docs-drift` | Guard: the generated agent docs under `packages/framework/agents/` must match what `bun run gen:agent-docs` renders from the current sources (feature manifest, renderer web exports, sample recipes), and every `agents/<file>.md` path the hand-written `packages/framework/AGENTS.md` points at must exist in that generated set. | - |
| `guard-app-feature-structure` | App features follow the bundled-features convention (reference: tenant/): feature.ts = registration only, screens under web/, handlers under handlers/. | `kumiko-lint-ignore app-feature-structure` |
| `guard-comment-issue-ref-only` | Comment Issue-Ref Guard: a comment that holds only an issue or PR reference or a planning label (`#1234`, `fw#1234`, `Phase 3`, `S2.H1`) and no explanatory word is a violation. | `kumiko-lint-ignore comment-issue-ref-only` |
| `guard-comment-lang` | Comment-language ratchet: no new German comments in product code. | `kumiko-lint-ignore comment-lang` |
| `guard-cross-feature-imports` | Guard: blocks cross-feature deep imports. | `kumiko-lint-ignore cross-feature-import` |
| `guard-direct-entity-writes` | Guard: forbids direct DB writes on tables registered as ES-entity projections. | - |
| `guard-direct-fetch` | Guard: finds raw `fetch(` calls in server code outside the client-scoped exceptions. | `kumiko-lint-ignore direct-fetch` |
| `guard-error-reasons` | Guard: `details.reason` strings and the first arg to UnprocessableError / failUnprocessable must follow the reason convention: | - |
| `guard-event-store-writes` | Guard: flags string/template literals containing UPDATE/DELETE FROM/INSERT INTO against kumiko_events, kumiko_snapshots or kumiko_archived_streams outside the event store's own files. | - |
| `guard-fake-tests` | Guard: tests must actually assert something. | - |
| `guard-feature-integration-tests` | Guard: every feature in packages/bundled-features/src/<name>/feature.ts must be imported by at least one *.integration.ts. | - |
| `guard-file-size` | File Size Guard — production files above 1200 lines are frozen in `.kumiko-file-size-baseline.json` (key = file, value = line count) and may not grow; a new file above the threshold is a violation. | - |
| `guard-guards-doc-drift` | Fails when docs/reference/guards.md differs from what the generator renders from the guard sources. | - |
| `guard-html-escape` | Guard: HTML-building template literals must escape every interpolation. | - |
| `guard-i18n-keys` | Guard: i18n keys must be defined before they are used. | - |
| `guard-i18n-locale-mount` | Guard: app mount points must register the German locale feature when the repo depends on @cosmicdrift/kumiko-locale-de. | - |
| `guard-i18n-locale-terminology` | Guard: locale bundle values must follow Mandant/Organización terminology. | `kumiko-lint-ignore i18n-locale-terminology` |
| `guard-i18n-ui-strings` | No hardcoded UI text in app web code: JSX text nodes and label-like string props must go through t("…") keys (guard-i18n-keys then checks that the keys are defined — this guard closes the gap before that: strings that never became keys, e.g. "Loading tenants…"). | `kumiko-lint-ignore i18n-ui-strings` |
| `guard-import-extensions` | Guard: relative imports in TypeScript sources name the source file (`./foo.ts`), not the emitted one (`./foo.js`). | - |
| `guard-internal-subpath-imports` | Guard: keeps the row-level-security escape hatches out of consumer code. | - |
| `guard-lib-test-coverage` | lib/ is the home of extracted logic (computation, parsing, mapping) — the no-logic-in-views guard pushes it there, this guard ensures it is also TESTED at the new location. | `kumiko-lint-ignore lib-test-coverage` |
| `guard-no-custom-primitives` | Apps no longer build their own UI primitives: components with primitive names (…Card, …Table, …Badge, …Button, …Chart, ProgressBar, MiniStat, …) exist in the framework (usePrimitives() resp. widgets/) — app rebuilds drift visually and cost every migration twice. | `kumiko-lint-ignore no-custom-primitives` |
| `guard-no-date-api` | Guard: finds Date-API patterns in production code where they are banned. | - |
| `guard-no-direct-fs` | Guard: finds direct `node:fs`/`fs` imports outside an allowlist. | `kumiko-lint-ignore direct-fs` |
| `guard-no-direct-process-env` | No-Direct-Process-Env Guard. | - |
| `guard-no-framed-extension-sections` | Extension-section components (registered via a ClientFeatureDefinition's `extensionSectionComponents`) are mounted inside RenderEdit's own section frame (Section in standalone screens, Card in tabs mode — see render-edit.tsx). | `kumiko-lint-ignore no-framed-extension-sections` |
| `guard-no-inline-styles` | No inline CSS in app code: `style={...}` props and `React.CSSProperties` style objects bypass theme tokens and dark mode. | `kumiko-lint-ignore no-inline-styles` |
| `guard-no-logic-in-views` | web/ contains components and hooks — computation, parsing and aggregation belong in lib/ (with a test). | `kumiko-lint-ignore no-logic-in-views` |
| `guard-no-raw-hooks` | Rerender protection: raw useEffect/useLayoutEffect + fetch() in app screens are the source of the endless-rerender class (unstable deps, setState-in-effect) and bypass the framework hook set (useQuery/ useMutation/useDisclosure — useQuery can go live via SSE). | `kumiko-lint-ignore no-raw-hooks` |
| `guard-no-temporal-polyfill-import` | Guard: finds value imports from `temporal-polyfill` outside kumiko-types. | - |
| `guard-primitives-discipline` | Guard: enforces that app-/feature-web code uses UI building blocks from the framework primitives, not hand-rolled Tailwind on raw HTML tags. | `kumiko-lint-ignore primitives-discipline` |
| `guard-public-exports-changelog` | Public exports of packages/framework and packages/bundled-features must not disappear (rename/removal) without a breaking changelog entry. | - |
| `guard-raw-classname` | Design comes from widgets/theme tokens, not raw Tailwind in app code. | `kumiko-lint-ignore raw-classname` |
| `guard-raw-interactive-elements` | Guard: raw interactive HTML elements in feature UI. | `kumiko-lint-ignore raw-interactive-elements` |
| `guard-raw-sql` | Raw-SQL Guard — blocks `.unsafe()` / `asRawClient()` outside allowed paths. | `kumiko-lint-ignore raw-sql` |
| `guard-renderer-boundaries` | Guard: prevents `@cosmicdrift/kumiko-renderer` (shared, platform-neutral) from touching DOM- or platform-specific APIs. | - |
| `guard-restricted-symbols` | Guard: finds imports/re-exports of the unscoped stream primitives outside an allowlist. | - |
| `guard-rls-session-settings` | Guard: row-level-security settings are transaction-local and written in one place. | - |
| `guard-schema-cli-features` | Guard: a consumer's `runSchemaCli(...)` call must pass `features: FEATURES` imported from `kumiko/schema`. | - |
| `guard-screen-conventions` | Usability mistakes in screen definitions that are statically decidable and otherwise come back screen by screen: a relatedList section whose rows lead nowhere, a row action labelled "edit" that does something else. | `kumiko-lint-ignore screen-conventions` |
| `guard-silent-skip` | Guard: finds "silent skip" spots in production code. | - |
| `guard-tailwind-scan-surface` | Guard: `className` string-literal tokens under kumiko-framework's `packages/bundled-features/src/**` must already be reachable through the real Tailwind `@source` scan surface (`packages/renderer/src` + `samples/**\/src`, see `packages/renderer/src/web/styles.css`). | `kumiko-lint-ignore tailwind-scan-surface` |
| `guard-tenant-escalation` | Guard: tenant / privilege-escalation safety. | - |
| `guard-test-es-fixtures` | Guard: tests seed event-sourced state through the event store, not through hand-written SQL. | - |
| `guard-test-es-row-writes` | Guard: framework tests do not write event-sourced rows through the seed bypass. | - |
| `guard-test-stack-drift` | Guard: *.integration.ts / *.integration.test.ts files must not construct a parallel server stack. | - |
| `guard-test-template-drift` | Guard: apps must not locally reimplement the e2e/screenshot template that `@cosmicdrift/kumiko-testing` already owns. | - |
| `guard-test-timeouts` | Guard: tests wait for a condition, not for time. | - |
| `guard-thin-wrappers` | Thin-Wrapper Guard (warning, never fails). | - |
| `guard-unsafe-array-param` | Warns when a `.unsafe(sql, [...])` parameter list holds a JS array (or a spread). | - |
| `guard-unsafe-json-parse` | Guard: JSON.parse calls must be inside a try/catch OR routed through the safe-json helpers (parseJsonSafe / parseJsonOrThrow). | - |
| `guard-upgrade-state` | Guard: a consumer repo's `.kumiko/upgrade-state.json` marker must be caught up with the installed Kumiko framework version. | - |
| `guard-write-handler-qns` | Guard: checks that `dispatcher.write("qn:literal:...")` calls in custom screens reference valid write-handler QNs. | - |
