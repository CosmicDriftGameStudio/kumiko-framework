---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Select options can be disabled per tenant, and the tier-engine gates them on write

A select option in the `select` primitive takes `disabled`, with the existing `description` as the hint. `renderer-web` mutes a disabled option and does not let it be chosen in the dropdown, the radio list, the radio cards and the segmented control; the dropdown appends the hint to the label in parentheses, the radio variants show it as the description line.

`SelectFieldDef.optionsAvailabilityQuery` names a query that returns `{ rows: { value, disabled?, hint? }[] }`. The renderer loads it, resolving `optionsQueryPayload` like `optionsQuery` does, and merges it onto the static `options`: `disabled` disables the option, `hint` becomes its description. Static options stay authoritative, rows for unknown values are ignored, and the currently stored value always stays enabled so a downgraded tenant keeps seeing it. The field is also allowed on entity fields, and boot fails when the query is not a registered query handler.

`createTierOptionGate` in the tier-engine takes the ascending tier order, `capsForTier` and `resolveTier`. Its `optionAvailability` builds the rows for such a query (an option the current tier does not allow is disabled and its hint names the lowest tier that allows it), and `withTierOptionGate` rejects a disallowed option on write with `UnprocessableError(code, { i18nKey, details: { field, value, requiredTier } })`. An update that resends the unchanged stored value of a no longer allowed option passes when the spec names the entity `table`. The wrapper spreads the wrapped handler, so `withCapEnforcement` and rate limits keep working.

<!-- kumiko-changes
feature: types
type: improvement
title: SelectFieldDef.optionsAvailabilityQuery marks static select options as unavailable per tenant
detail: The query returns { rows: { value, disabled?, hint? }[] }; the renderer merges it onto options and keeps the stored value enabled.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validation and the client schema cover select optionsAvailabilityQuery on entity and screen fields
-->

<!-- kumiko-changes
feature: headless
type: improvement
title: Edit view-model carries selectOptionsAvailabilityQuery for select fields
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Select inputs accept disabled options and load their availability from optionsAvailabilityQuery
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Disabled select options are muted and not choosable in dropdown, radio list, radio cards and segmented control
-->

<!-- kumiko-changes
feature: tier-engine
type: improvement
title: createTierOptionGate builds the availability rows and gates select options by tier on write
detail: withTierOptionGate rejects a disallowed option with the lowest tier that allows it and lets an unchanged stored value pass on update.
-->
