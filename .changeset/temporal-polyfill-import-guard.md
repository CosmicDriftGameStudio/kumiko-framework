---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-guards": minor
---

Direct `temporal-polyfill` imports are now a manual upgrade step and a guard error

Since 0.351.0 the native `globalThis.Temporal` is the single Temporal source whenever the runtime has one. App code that still imports `Temporal` from `temporal-polyfill` gets the polyfill classes, while the framework hands it native ones, so `instanceof Temporal.Instant` and `z.instanceof(Temporal.Instant)` fail ("expected Instant, received Instant"). 0.351.0 shipped this as an improvement, so `kumiko-upgrade` never flagged it. It now shows up as an open manual step, and the new No-Temporal-Polyfill-Import guard reports every value import from `temporal-polyfill` (including `temporal-polyfill/global`, re-exports, `import()` and `require`) outside kumiko-types, with the replacement import. `import type` and `/// <reference types="temporal-polyfill/global" />` stay allowed.

<!-- kumiko-changes
feature: types
type: breaking
title: Apps must import Temporal from @cosmicdrift/kumiko-types/temporal instead of temporal-polyfill (affects every app since 0.351.0)
detail: Since 0.351.0 the native globalThis.Temporal wins over the polyfill. A Temporal imported from "temporal-polyfill" is a second implementation, so instanceof and z.instanceof(Temporal.Instant) reject values the framework creates. This applies whether you upgrade from before 0.351.0 or are already on it.
migration: Replace every value import from "temporal-polyfill" in app code and tests, e.g. `import { Temporal } from "temporal-polyfill"`, with `import { Temporal } from "@cosmicdrift/kumiko-types/temporal"`, and drop side-effect imports of "temporal-polyfill/global" (importing @cosmicdrift/kumiko-types/temporal already installs the global when the runtime has none). `import type` and `/// <reference types="temporal-polyfill/global" />` may stay. Then run `kumiko check`; the No-Temporal-Polyfill-Import guard lists anything left. Close the step with `kumiko-upgrade --resolve <id> --reason "<what you changed>"`, or add `--not-applicable` when the repo never imported temporal-polyfill.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: New No-Temporal-Polyfill-Import guard reports direct temporal-polyfill value imports outside kumiko-types
detail: Scans source and test files (ts, tsx). Flags named, default, namespace and side-effect imports, re-exports, import() and require of "temporal-polyfill" or its subpaths, and prints the replacement import from @cosmicdrift/kumiko-types/temporal. Type-only imports and triple-slash type references pass.
-->
