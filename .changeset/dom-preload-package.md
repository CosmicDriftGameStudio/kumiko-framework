---
"@cosmicdrift/kumiko-testing": minor
---

kumiko-testing bunfig --dom now preloads a package-owned DOM preload instead of requiring an app-local ./test-setup/dom.preload.ts

<!-- kumiko-changes
feature: testing
type: breaking
title: bunfig --dom preloads the package's own DOM setup instead of an app-local file
detail: |
  The package now exports `./preload/dom`, the happy-dom GlobalRegistrator
  setup (IS_REACT_ACT_ENVIRONMENT, Bun's native fetch/Request/Response
  preserved over happy-dom's broken cookie header, testing-library/react
  cleanup, Radix pointer-capture/scrollIntoView stubs, the inspect-size
  limit for waitFor) that each app using --dom previously copied into its
  own ./test-setup/dom.preload.ts. `kumiko-testing bunfig --dom` now generates
  bunfig.dom.toml with @cosmicdrift/kumiko-testing/preload/dom instead of
  the app-local path. @happy-dom/global-registrator and
  @testing-library/react are optional peer dependencies, same as
  @playwright/test for ./e2e. This reverses kumiko-framework#3128, which
  kept the file as an app-local copy because at the time it was
  workspace-internal, not a published contract. In practice the copies
  never diverged on purpose, only by drift: publicstatus, phronexsis and
  kumiko-enterprise carried older, partial copies of the framework's own
  test-setup/dom.preload.ts (missing the inspect-size fix for #3082), and
  only offlot-app matched the framework's code (comments reworded, no
  functional diff). The framework's own copy is now deleted; the
  framework runs the same package preload it ships.
migration: |
  In every bunfig file that lists "./test-setup/dom.preload.ts"
  (publicstatus, phronexsis, offlot-app and kumiko-enterprise each have
  exactly one, their bunfig.dom.toml), replace that line with
  "@cosmicdrift/kumiko-testing/preload/dom", then delete the now-
  unreferenced ./test-setup/dom.preload.ts. Ensure
  @happy-dom/global-registrator and @testing-library/react are in the
  app's devDependencies (all four already have both). Running
  `kumiko-testing bunfig --dom` instead also works: mergeBunfig now keeps
  an app-local extra preload (publicstatus's
  env.preload.ts/codegen.preload.ts) across the regen instead of dropping
  it, and treats an existing "./test-setup/dom.preload.ts" entry as
  superseded rather than an extra, so it doesn't end up preloaded twice
  alongside the new package path. The generated preload array's own
  entries stay first; a carried-over extra lands after them, which can
  move it relative to entries that used to sit between the template's
  preloads and the app's own (publicstatus: dom.preload.ts used to run
  last, after env/codegen; the package preload now runs before them).
-->
