---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

`guard-no-direct-fs` has a repo-local exception: `// kumiko-lint-ignore direct-fs <reason>` on the `node:fs` import (or the line above) suppresses the finding only while the `<file>::<reason>` pair is frozen in `.kumiko-direct-fs-baseline.json` at the repo root. It fails closed: without a baseline file, with an unreadable file, with a changed reason, or with more markers than frozen, the finding stays. A bare tag without a reason does not count. Freeze with `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"`. The guard hint now points to the marker, `FileStorageProvider` and `readBundledAsset`. `AstGuard.writeBaseline` receives the scanned roots as an optional second argument, and `baselineRatchet` takes an opt-in `failClosed` that treats a missing baseline file as empty.

**Migration (breaking-ish):** the framework allowlist no longer contains `src/marketing/render-landing.ts` and `src/marketing/rebuild-pages-job.ts` for every repo. Apps that have these files (today money-horse, phronexsis, show-pony, publicstatus) put `// kumiko-lint-ignore direct-fs <reason>` above the `node:fs` import in each file and run `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"` once in the app repo. Commit the generated `.kumiko-direct-fs-baseline.json`.

`@cosmicdrift/kumiko-server-runtime` can ship read-only files from an app's own build. Declare them in `package.json` under `kumiko.assets` (`[{ "name": "inter-bold.ttf", "source": "packages/site-kit/fonts/inter-bold.ttf" }]`, `source` relative to the app's `package.json`). `buildProdBundle` copies them to `dist/kumiko-bundled-assets/`, which the static file server does not serve, and fails the build on an invalid name, a duplicate, a source outside the package or a missing file. `readBundledAsset(name)` and `resolveBundledAsset(name)` read the dist copy in prod and the declared source in dev, so apps need no `node:fs` for it.

<!-- kumiko-changes
feature: guards
type: breaking
title: Repo-local direct-fs exceptions with a frozen reason, bundled read-only assets
migration: |
  The allowlist no longer frees src/marketing/render-landing.ts and src/marketing/rebuild-pages-job.ts in every repo. Put // kumiko-lint-ignore direct-fs <reason> above the node:fs import in each such file, run kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard" once and commit .kumiko-direct-fs-baseline.json.
-->
