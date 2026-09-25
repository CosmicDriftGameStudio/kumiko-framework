---
"@cosmicdrift/kumiko-guards": minor
---

Three closing guards for the test-template contract (fw#3118)

<!-- kumiko-changes
feature: guards
type: breaking
title: test-timeouts is now always-enforcing, plus two new guards (test-template-drift, Real-Provider-Isolation)
detail: |
  test-timeouts drops its transitional baseline/ratchet — any sleep loop,
  test.setTimeout/test.slow, or waitForTimeout finding fails the guard run
  directly, with no `.kumiko-test-timeouts-baseline.json` grandfathering
  pre-existing violations.
  New AST guard test-template-drift flags apps reimplementing the
  kumiko-testing e2e/screenshot template locally: a Playwright config that
  builds its own defineConfig(...) instead of calling defineAppE2eConfig(),
  a literal deviceScaleFactor override anywhere (test.use, a project's use,
  or the config's own use block), a literal viewport override in a
  playwright*.config.ts's own use or a project's use (a spec's own
  test.use({ viewport }) is not flagged — it's the documented way to assert a
  layout that only exists below the template's 1920px default; a
  `...devices["…"]` spread stays allowed everywhere), or a direct
  page.screenshot(...) call instead of captureScreenshot.
  New repo check Real-Provider-Isolation flags a CI workflow that references
  KUMIKO_REAL_PROVIDERS or invokes test:real/e2e:real, a package.json script
  other than test:real/e2e:real that leaks the real-provider env or a
  *.real. spec/test reference, and one of the template's own non-real bunfig
  files (bunfig.toml, bunfig.integration.toml, bunfig.dom.toml) missing the
  **/*.real.test.ts exclusion.
migration: |
  Fix or mark each test-timeouts finding: replace hand-rolled poll loops with
  the shared `waitFor` from @cosmicdrift/kumiko-framework/testing, or add
  `// @timeout-exception: #<issue> <technical reason>` on the loop's own line
  or the line above for a genuine non-condition wait. Delete any committed
  `.kumiko-test-timeouts-baseline.json`.
  For test-template-drift: switch a hand-rolled Playwright/screenshot config
  to defineAppE2eConfig(), drop config-level viewport/deviceScaleFactor
  overrides (the template already sets DESKTOP_VIEWPORT and renders
  screenshot runs at SCREENSHOT_DEVICE_SCALE_FACTOR), and replace direct
  page.screenshot(...) calls with the template's captureScreenshot. Specs
  asserting a layout that only exists below 1920px set their own viewport via
  test.use({ viewport }) — no exception marker needed. A deliberate exception
  for anything else the guard flags (e.g. a handbook screenshot helper that
  needs its own viewport-growth pass) is
  `// @template-drift-exception: #<issue> <technical reason>` on the line
  above.
  For Real-Provider-Isolation: remove any KUMIKO_REAL_PROVIDERS/test:real/
  e2e:real reference from CI workflows, move real-provider env/spec
  references out of scripts other than test:real/e2e:real, and regenerate
  bunfig.toml/bunfig.integration.toml/bunfig.dom.toml via
  `kumiko-testing bunfig` instead of hand-editing pathIgnorePatterns.
-->
