---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"create-kumiko-app": patch
"@cosmicdrift/kumiko-samples": patch
---

StepList gets selection with prerequisites, Banner a compact one-line form with icon and an ok variant, FloatingPanel a fixed placement, and the new bundled feature presence shows who else is on a record.

<!-- kumiko-changes
feature: renderer
type: improvement
title: StepList selection with prerequisites, compact Banner, fixed FloatingPanel
detail: `StepList` takes an optional `selection` (`selectedIds`, `onSelectionChange`, `actions`). It adds a checkbox per step, a "Select all" row with a count ("2 selected, 1 waiting for input") and, while something is selected, footer actions labelled with the count whose `onClick` receives the effective selection in list order. A step's `dependsOn` lists prerequisites: selecting the step selects them too (marked "Also selected: needed for …"), and unselecting a prerequisite drops the steps that need it. `selectable` per step is `{ kind: "selectable" }`, `{ kind: "missing-input", reason }` (checkbox disabled, "Input missing" tag) or `{ kind: "none" }` (no checkbox), so an app can keep risky steps out of bulk actions. A step whose open prerequisite cannot be selected is disabled with "Review “…” on its own first". Without `selection` the list renders as before. `Banner` takes `density: "compact"` (one line, title inline), `icon` (a nav icon key) and the variant `"ok"` for a finished state. `FloatingPanel` takes `placement: { mode: "fixed", rightPx, bottomPx, widthPx, heightPx }` (anchored, no drag, no resize, nothing persisted), `bodyLayout: "fill"` (children pad and scroll themselves) and `surface: "ai"`. New exports: `StepSelectability`, `StepSelectionAction`, `StepListSelection`, `FloatingPanelPlacement`, plus `usePresence`, `usePresenceList`, `PresenceNotice`, `PresenceAvatars`; `Avatar` takes `size: "xs"` and `shape: "round"`.
-->

<!-- kumiko-changes
feature: presence
type: improvement
title: New bundled feature presence: who else is on this record right now
detail: `createPresenceFeature({ entities, roles?, ttlSeconds? })` lets a browser announce that the user is viewing or editing one row of an allow-listed entity (`presence:write:heartbeat` every 15 seconds, `presence:write:leave` on close) and answers with the other people on it; `presence:query:list` returns them for up to 100 rows of a list. It only informs and never locks. State is ephemeral in a Redis hash per session tenant, entity and row (in memory without Redis), holds user ids only and expires after `ttlSeconds` (default 45) without a heartbeat; display names are resolved per response. A caller sees presence only for rows they can read; other rows answer 404. Defaults to TenantAdmin and TenantMember, entities default to none, the handlers are hidden from the AI agent. A Redis or SSE outage logs a warning and answers with an empty room. On a change the other people on the row get an addressed live signal through the new handler service `ctx.services.userLiveSignals`, which pushes SSE frames to named users of the caller's own tenant. The renderer hooks `usePresence` and `usePresenceList` and the widgets `PresenceNotice` and `PresenceAvatars` stay silent when the feature is not mounted.
-->
