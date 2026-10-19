---
"@cosmicdrift/kumiko-dev-server": minor
---

`kumiko-build` writes `dist-server/bun.lock`

The server bundle's `package.json` only carries version ranges, so the runtime image installed whatever was newest at image-build time. `kumiko-build` now copies the nearest `bun.lock` above the app into `dist-server/` and runs `bun install --lockfile-only` there with the Bun that runs the build. Packages the app lock already pins keep their versions; the rest resolve fresh. Without a `bun.lock` above the app the lockfile is resolved fresh and the build prints a warning. A failing `bun install --lockfile-only` fails the build. `buildServerBundle` itself stays offline; `writeServerLockfile` is exported from `@cosmicdrift/kumiko-dev-server/cli`.

The deploy template installs with `bun install --production --frozen-lockfile`.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: kumiko-build pins dist-server dependencies with a bun.lock seeded from the app's bun.lock
detail: The lock is written by writeServerLockfile after the bundle build and needs network or a warm Bun cache. The scaffolded Dockerfile runs bun install --production --frozen-lockfile in the runtime stage.
migration: Apps with their own Dockerfile should run `bun install --production --frozen-lockfile` in dist-server instead of `bun install --production`.
-->
