---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Dashboards can embed a projectionDetail as a screen panel, list toolbar actions can be gated with `visibleWhen`, a screen `fallback` can pick its screen by failure reason, and the live-signal entity name now comes from one shared `toKebab`. All additions are optional.

<!-- kumiko-changes
feature: renderer
type: improvement
title: A projectionDetail can be a dashboard screen panel
detail: A `screen` panel or its `fallback` may point at a projectionDetail. The id comes from the host dashboard's `record` binding and is passed to the embedded screen as its entityId. Boot fails when the host dashboard has no `record`. Header, fields and Detail query render inline in the tile.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Toolbar actions accept visibleWhen
detail: Every toolbar action of a projectionList or entityList takes an optional `visibleWhen` ({ query, field, eq }). The button shows only while the live query matches; it stays hidden while the query loads and when it fails. Buttons gating on the same query share one request. Boot checks the query, its output field and that it needs no input. relatedList toolbar actions reject `visibleWhen`.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Screen fallback can depend on the failure reason
detail: A screen-level `fallback` is either a screen id (unchanged) or a map `{ hidden, forbidden, notFound, error }`. `forbidden` is a 403 and `notFound` a 404 on the gate query; `hidden` is an unmet condition; `error` is any other failure. A reason without an entry shows a default notice (new keys kumiko.screen.forbidden and kumiko.screen.notFound) and `error` shows an error banner with retry. Boot rejects an empty map and checks each entry like a string fallback.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Live signals for entity names with uppercase runs reach the client
detail: `toKebab` now lives once in `@cosmicdrift/kumiko-types/kebab-case` and is used by the server read-access keys, the qualified-name helpers and the renderer. Before, the renderer and server copies could diverge for names like `aiURLCheck`, so a screen subscribed to a name the server never signalled.
-->
