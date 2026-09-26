---
"@cosmicdrift/kumiko-testing": minor
---

kumiko-testing bunfig --dom now preloads a package-owned DOM preload instead of requiring an app-local ./test-setup/dom.preload.ts

<!-- kumiko-changes
feature: testing
type: breaking
title: bunfig --dom preloads the package's own DOM setup instead of an app-local file
detail: |
  `--dom` exported `./preload/dom`, the happy-dom GlobalRegistrator setup
  (IS_REACT_ACT_ENVIRONMENT, Bun's native fetch/Request/Response preserved
  over happy-dom's broken cookie header, testing-library/react cleanup,
  Radix pointer-capture/scrollIntoView stubs, the inspect-size limit for
  waitFor) that every app previously copied into its own
  ./test-setup/dom.preload.ts. `kumiko-testing bunfig --dom` now generates
  bunfig.dom.toml with @cosmicdrift/kumiko-testing/preload/dom instead of
  the app-local path. @happy-dom/global-registrator and
  @testing-library/react are optional peer dependencies, same as
  @playwright/test for ./e2e.

  This reverses kumiko-framework#3128, which had apps keep their own copy
  so the function could evolve per app. In practice the function never
  diverged on purpose, only by drift: publicstatus and phronexsis carried
  older, partial copies of the framework's own test-setup/dom.preload.ts,
  and only offlot-app stayed byte-identical. The framework's own copy is
  now deleted; the framework runs the same package preload it ships.
migration: |
  Delete the app's local ./test-setup/dom.preload.ts, then run
  `kumiko-testing bunfig --dom` to regenerate bunfig.dom.toml against the
  package preload. Install @happy-dom/global-registrator and
  @testing-library/react as devDependencies if the app doesn't already
  have them (they were previously only implicit through the copied file's
  own imports).
-->
