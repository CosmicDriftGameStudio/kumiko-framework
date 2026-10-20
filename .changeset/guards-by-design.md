---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-guards": minor
---

Error classes that CI guards used to find after the fact are now rejected by types, the boot validator or runtime checks, and the redundant guards are gone.

<!-- kumiko-changes
feature: framework
type: breaking
title: Placeholder reasons are rejected at boot and at runtime
detail: An empty, whitespace-only or placeholder reason ("todo", "tbd", "fixme", "legacy", "temp", "wip", "n/a", "none", "xxx", a "todo:" / "fixme:" / "tbd:" prefix, or the migrate-cross-tenant codemod marker) now fails boot for `openToAll.reason` and `escapeHatch.reason`, and throws at call time for `ctx.systemDb.unsafeRaw(reason)`, `acknowledgeCrossTenant(reason)`, `unsafeAllTenants: { reason }` on read steps and `declareEscapeHatch({ reason })`, which is no longer a no-op. The Escape-Hatch-Declared and Open-To-All-Reason guards that checked this statically are removed.
migration: Replace every placeholder reason with the real justification (why this access is needed and on whose right). Reasons held in imported constants were never judged by the guards and surface now, at boot or on first use.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: loadAllEventsByType and LOAD_ALL_EVENTS_ROW_LIMIT are removed
detail: loadAllEventsByType buffered every event of an aggregate type in memory and had no production caller. It is removed together with LOAD_ALL_EVENTS_ROW_LIMIT and the Loadall-Events guard.
migration: Use `await Array.fromAsync(streamAllEventsByType(db, aggregateType))`, or iterate the stream with `for await` to stay memory-bounded. The stream is ordered by event id; loadAllEventsByType ordered by (createdAt, id).
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: metricField is removed from the screen type exports
detail: metricField is removed from the engine types and ui-types exports because MetricSpec is always an object now.
migration: Replace `metricField(metric)` with `metric.field`.
-->

<!-- kumiko-changes
feature: types
type: breaking
title: MetricSpec requires the object form with a label
detail: The plain string shorthand for projectionDetail `metrics` is removed and `label` (an i18n key) is required, so a metric can no longer render as a bare column name. `metricField()` is removed from the screen exports because it is trivial now; read `metric.field`. The `metrics` entry without label check in the Screen-Conventions guard is dropped, the type enforces it.
migration: Replace `metrics: ["balance"]` with `metrics: [{ field: "balance", label: "<i18n key>" }]`, reusing the key you had in `fieldLabels` for that column. Replace `metricField(metric)` with `metric.field`.
-->

<!-- kumiko-changes
feature: types
type: breaking
title: EditFieldsSection is either fields or groups
detail: EditFieldsSection is now a union of a section with `fields` and a section with `groups`; the groups branch has no `fields` key, so a raw `section.fields` read on a section does not compile and `fields: []` next to `groups` is no longer needed. The boot validator rejects a section that declares both, including `fields: []`. FieldsOrGroupsSection now has optional `fields` and `groups`. Read a section's fields through `sectionFieldSpecs`, which the Section-Fields-Raw guard used to enforce.
migration: Remove `fields: []` from every section that declares `groups`. Code that reads `section.fields` or `section.groups` of a fields section uses `sectionFieldSpecs(section)` or narrows with `"groups" in section`.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail metrics render their own label
detail: The metrics band reads the label from each metric entry instead of falling back to `fieldLabels` or the column name.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Nine guards are removed because types and boot checks replace them
detail: Removed guards and their replacement. Text-Field Personal-Stance: the field factories require `personal`. API-Object-Form: the registrar only has the object form. Table-DDL (warning only), Pre-ES-Patterns and No-Broker-Subscribe (the broker is not exported). Open-To-All-Reason and Escape-Hatch-Declared: boot and runtime reason validation. Loadall-Events: the function is removed. Section-Fields-Raw: EditFieldsSection is a union. Screen-Conventions loses rule R1 (metrics without label), the type enforces it.
migration: Delete `.kumiko-text-field-stance-baseline.json` and `.kumiko-section-fields-raw-baseline.json`. In `.kumiko-security-baseline.json` the "Escape-Hatch-Declared Guard" and "Open-To-All-Reason Guard" entries in `hardFail` can be removed (they are ignored now). Remove leftover `kumiko-lint-ignore section-fields-raw` markers.
-->
