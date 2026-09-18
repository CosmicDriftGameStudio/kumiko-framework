---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

`validateBoot` now accepts an optional `navAllowlist` and warns at boot for every declared nav whose screen isn't reachable from any allowlisted nav entry, since such a screen was silently unreachable via the sidebar with no signal (fw#3019, hit twice: solon#113 and offlot's VIN screen). A new `navAllowlistExempt` option suppresses the warning for navs that are deliberately left out of the allowlist because their screen is reachable another way (e.g. a generated settings hub). When an app has no explicit `navAllowlist` but does have workspaces, the allowlist is now derived automatically from `r.workspace({ nav })` and `r.nav({ workspaces })` assignments — covering solon#113's case without requiring solon to pass anything. `filterAppSchemaNavsByAllowlist` and `NavReparentOverride`, previously duplicated per-app, are now exported from `@cosmicdrift/kumiko-renderer-web`.

<!-- kumiko-changes
feature: navigation
type: improvement
title: boot-time reachability warning for nav entries outside the app's sidebar allowlist, filter helper moved into the framework
detail: |
  Adds `warnOnUnreachableNavScreens(allNavQns, allowedNavQns, navAllowlistExempt?)`
  to packages/framework/src/engine/boot-validator/nav.ts, in the same
  non-fatal console.warn style as the existing warnOnNavAccessInversion.
  The rule checks screen reachability, not nav-QN membership: it builds
  the set of screens reached by an allowlisted nav, then warns for every
  unallowlisted nav whose screen isn't in that set. A naive "nav QN not
  in allowlist" rule was tried first and measured against the real
  offlot-app schema (58 navs, 30 allowlisted) — it fired 28 warnings per
  boot, mostly app-shell leaves that intentionally re-target a screen an
  allowlisted nav already reaches, which would have buried the one real
  bug (offlot's VIN screen) in noise. The reachability rule fires 8 times
  on the same schema, all of them either the real bug or exemptable.
  ValidateBootOptions gains `navAllowlist?: ReadonlySet<string>` and
  `navAllowlistExempt?: ReadonlySet<string>`; when navAllowlist is set,
  validateBoot calls the new warning right after warnOnNavAccessInversion,
  passing navAllowlistExempt through so an app can mark navs whose screen
  is reachable outside the sidebar (e.g. as a sub-page of a generated
  settings hub) without regenerating the noise.
  Separately, `filterAppSchemaNavsByAllowlist` and `NavReparentOverride`
  move from offlot-app's local copy into
  packages/renderer-web/src/layout/filter-app-schema-navs.ts and are now
  exported from @cosmicdrift/kumiko-renderer-web, reusing nav-tree.tsx's
  existing (now exported) qualifyNavId instead of keeping a second copy
  of that qualification logic in sync across apps.
  fw#3019 covered offlot's app-local allowlist but not solon#113, which
  assigns navs to workspaces via `r.workspace({ nav: [...] })` and never
  passes navAllowlist — the warning stayed silent for that shape.
  packages/framework/src/engine/boot-validator/workspaces.ts gains
  `deriveNavAllowlistFromWorkspaces(allNavQns, allWorkspaceQns)`, which
  unions every `WorkspaceDefinition.nav` entry with every nav QN whose
  `NavDefinition.workspaces` self-assigns to at least one workspace — both
  fields already hold fully-qualified QNs (same as validateWorkspaces /
  validateNavs compare them), so no re-qualification step is needed.
  `resolveNavAllowlist(explicitAllowlist, allNavQns, allWorkspaceQns)`
  wraps it: an explicit `navAllowlist` always wins, otherwise the derived
  set is used only when the app has at least one workspace (an app with
  none must produce no warnings), else `undefined` (no check runs).
  validateBoot now calls `resolveNavAllowlist` before
  warnOnUnreachableNavScreens instead of gating on `options.navAllowlist`
  directly.
-->
