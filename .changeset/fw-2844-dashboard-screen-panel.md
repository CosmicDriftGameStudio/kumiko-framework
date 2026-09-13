---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

fw#2844 (decision fw#2841): declarative screens are composable. A `dashboard` takes a new `DashboardScreenPanel` (`kind: "screen"`) that embeds another registered screen — `screen` is a same-feature short id or a cross-feature QN `<feature>:screen:<id>`, resolved like actionForm `redirect`. Together with `kind: "custom"` for app content this replaces the "framework screen plus own content" custom screens three consumer apps carried with an `app-feature-structure` lint-ignore.

- The boot-validator rejects an unresolvable target and target types that can't stand in a tile: `dashboard` (no nesting), `entityEdit`/`projectionDetail` (need a route id), `custom` (use a custom panel), `entityList`. Embeddable: `projectionList`, `actionForm`, `secretMint`, `configEdit`, `secretsEdit`.
- `visibleWhen: { query, field, eq }` shows the panel only while `field` of the query's flat result equals `eq`. The query runs live, so a write that flips the state (e.g. `auth-mfa:query:user-mfa:status`) swaps panels without reload; hidden while loading. The query is checked against registered query handlers at boot.
- A user without access to the target screen doesn't get the tile at all — no "access denied" banner inside an otherwise working page.
- `@cosmicdrift/kumiko-renderer` exports `useEmbeddedScreen(hostFeatureName, screen)`; `DashboardBodyProps` gains the required `featureName` (KumikoScreen passes it; only relevant for a custom dashboard body implementation).

Bundled self-service screens so account security needs no custom code:

- `auth-mfa`: `auth-mfa-disable` (actionForm on `auth-mfa:write:disable`) and `auth-mfa-regenerate-recovery` (secretMint on `auth-mfa:write:regenerate-recovery`, one-time reveal of the new codes), next to the existing `auth-mfa-enable`. Exported ids `MFA_DISABLE_SCREEN_ID`, `MFA_REGENERATE_RECOVERY_SCREEN_ID`.
- `sessions`: `my-sessions` (projectionList, open to every signed-in user) on `sessions:query:user-session:mine` — revoke per row (hidden on the current session) and "sign out all other devices". Exported id `SESSION_MINE_SCREEN_ID`.

**BREAKING**

`sessions:query:user-session:mine` returns the paged envelope `{ rows, nextCursor: null }` instead of a bare array, so the projectionList can bind to it (same migration `personal-access-tokens:query:mine` went through). Migration: read `data.rows` instead of `data`. The account-security custom screens in money-horse, publicstatus and kumiko-studio that call this query are superseded by the composition above (money-horse#477, publicstatus#435, kumiko-studio#283).
