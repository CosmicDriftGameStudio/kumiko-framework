---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-dev-server": patch
---

dev/prod-parity: validateBoot in dev-server + standalone-stable renderer-web @source + CSS-completeness guard (#359)

Two prod-only breakages closed, both caused by the dev path validating/building
differently than the prod path:

- **Boot-validation parity**: `runDevApp` now runs the same `validateBoot` as
  `runProdApp`, before the fs-watcher and server start. Unqualified nav-/handler
  QNs, unresolvable navigate-targets and screen-access errors now fail fast in
  dev instead of only crashing the prod pod (CrashLoopBackOff).
- **renderer-web stylesheet scans its own shell standalone**: `renderer-web/src/styles.css`
  scanned its shell classes via a monorepo-relative `@source` (`../../renderer-web/src`),
  which only resolves through the workspace symlink. A standalone consumer install
  found nothing → unstyled prod (15KB vs 48KB). It is now self-relative (`./`),
  which resolves in every install layout since the package ships `src`. Behaviour
  in the monorepo is identical (`./` ≡ the old path at the real location).
- **Build-time CSS-completeness guard**: when `kumiko-build` falls back to the
  packaged renderer-web stylesheet, it now asserts the compiled CSS contains the
  shell sentinel class and fails loud (with a `src/styles.css` hint) instead of
  shipping an unstyled image.
