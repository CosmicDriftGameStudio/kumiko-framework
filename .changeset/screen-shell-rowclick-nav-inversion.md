---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix a list screen looking clickable when clicking a row was actually a silent no-op: `effectiveOnRowClick` in `createKumikoApp` is now `undefined` for the active list screen unless it has a reachable target (a `detailFor` detail screen for its entity, an app-wide `onRowClick`, or an `entityEdit` screen for the entity) — no target now means no `cursor-pointer` and no click handler on the rows instead of an unconditionally-wired one.

Also:
- Corrected `FormScreenShell`'s doc comment, which claimed its default width matches full-width list chrome — the actual default is `4xl` (a centered column).
- `PageSection` (primitives/layout.tsx) gains an optional `maxWidth` prop reusing the same 3xl/4xl/full class map as `FormScreenShell` (now defined once and shared); `dashboard-body.tsx`'s hand-rolled dashboard-screen container (`WebDashboardBody`, not the list path — a list screen's own padding comes from `DataTable`'s wrapper in primitives/index.tsx, left as-is) now renders through `PageSection` instead of duplicating its padding.
- The nav boot-validator now warns (never fails boot) when a nav leaf's role gate is disjoint from its parent section's role gate — a section that only certain roles can reach but whose child requires a completely different role set renders with zero visible children for every user who can see it.
