---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-feature-ast": minor
"@cosmicdrift/kumiko-testing": minor
---

Guards that only inspect one file move to Biome builtins and GritQL plugins behind one shared preset, `@cosmicdrift/kumiko-framework/biome-rules`.

<!-- kumiko-changes
feature: guards
type: breaking
title: Single-file guards are replaced by the Biome preset biome-rules
detail: The guards admin-api, direct-fetch, error-reasons, event-store-writes (es-literal-writes), i18n-locale-terminology, no-custom-primitives, no-date-api, no-direct-fs, no-direct-process-env, no-inline-styles, no-raw-hooks, no-temporal-polyfill-import, primitives-discipline, raw-classname, raw-interactive-elements, restricted-symbols, test-es-fixtures, test-title and unsafe-json-parse are deleted together with their baselines. Their checks run as Biome builtins or GritQL plugins from `packages/framework/presets/biome-plugins/*.grit`. New checks cover createTestDispatcher, barrel imports from the same folder, external font CDNs (also in CSS), skipped or retried tests and CSSProperties types. The guards silent-skip, thin-wrappers and check-predicates are removed without replacement (the `// @wrapper-known` and silent-skip markers are dead and can be deleted). `kumiko check` gains a `lint` step (`biome lint` in the app repo) and an `agent` step (kumiko agent lint) for apps with a kumiko.config.ts.
migration: Extend the preset in your `biome.json`, replacing your own linter rules for these checks - `"extends": ["@cosmicdrift/kumiko-framework/biome-rules"]` (apps that already extend `biome-app` get it through that preset). Delete `.kumiko-direct-fs-baseline.json`, `.kumiko-test-title-baseline.json`, `.kumiko-no-custom-primitives-baseline.json` and `.kumiko-test-timeouts-baseline.json`. `bun kumiko-upgrade --apply` runs the codemod lint-ignore-to-biome, which turns `kumiko-lint-ignore <slug> <reason>` markers of the deleted guards into `biome-ignore lint/plugin: <reason>` (`lint/style/noInlineStyles` for no-inline-styles), keeps the comment form and the reason, and lists markers without a reason of at least three words. Biome applies a suppression only to the next line or node, so a marker that sat several lines above its hit moves by hand (CSS - `biome-ignore lint/plugin: <reason>` inside a comment). Remove deleted guard names from your `kumiko.json` and security baseline. Enterprise and platform extend the same preset.
codemod: scripts/codemod/lint-ignore-to-biome.ts
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Biome preset biome-rules with GritQL plugins
detail: `@cosmicdrift/kumiko-framework/biome-rules` bundles the linter rules and the GritQL plugins that replace the deleted guards, plus the new builtins noNestedComponentDefinitions, noMisusedPromises, useExhaustiveSwitchCases and noTsIgnore. `biome-app` now extends it. Suppress a plugin finding with `biome-ignore lint/plugin: <reason>`. `test-title` and the raw interactive element rule (`a`, `details`, `summary` in `raw-ui-in-app`) only warn, in the framework too, because the replaced guards only warned in repos without a baseline; every other plugin rule is an error. The screen container rule (`mx-auto` + `max-w-*`) is its own plugin `no-screen-container-classes` and does not apply under `public/`. `biome lint` takes about 3.2x as long with the plugins (every regex sits behind a cheap prefilter). The server-side plugins also scan `bin/` and `scripts/`. noImportCycles stays off (253 findings in the framework repo). noRestrictedImports flags type imports of temporal-polyfill too (the old guard allowed them); use `@cosmicdrift/kumiko-types/temporal`. The scaffold main.ts starts with `biome-ignore-all lint/style/noProcessEnv`, since it wires KMS from the environment before runProdApp parses the env contract.
migration: Apps on `biome-app` get the preset automatically; fix new findings or suppress them with a reason. Repos with their own biome.json add `"extends": ["@cosmicdrift/kumiko-framework/biome-rules"]`.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: seedRowsViaEventStore seeds several rows through the event store
detail: `@cosmicdrift/kumiko-testing/helpers` exports `seedRowsViaEventStore(db, table, rows)`, the event store counterpart of `seedRows`. Each row becomes its own event stream.
-->
