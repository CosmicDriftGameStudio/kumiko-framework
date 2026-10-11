---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Multi-select options can be hidden per caller, and the member roles form only offers assignable roles

`MultiSelectFieldDef.optionsAvailabilityQuery` names a query that returns `{ rows: { value, disabled?, hint? }[] }`, called with an empty payload. The renderer hides every option whose row has `disabled: true`, in the combobox and in the `display: "checkboxes"` grid, unless the value is currently selected. `hint` is ignored because the combobox cannot show a per-option hint. Static `options` stay authoritative, and until the result arrives or when the query fails all options are shown, so the write path still has to enforce the rule. Boot fails when the query is empty or not a registered query handler, on entity fields and on form screen fields.

The tenant feature registers `tenant:query:member-role-availability` and wires it to the `roles` field of `memberRolesEditScreen`. An Admin no longer sees TenantAdmin or an app role declared with `assignableFrom: "TenantAdmin"`; a TenantAdmin sees every role. The rank rule is the one `updateMemberRoles` already enforces, so the server behaviour is unchanged.

<!-- kumiko-changes
feature: types
type: improvement
title: MultiSelectFieldDef.optionsAvailabilityQuery hides static multiSelect options per caller
detail: The query returns { rows: { value, disabled?, hint? }[] }; disabled options are hidden unless currently selected.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validation covers multiSelect optionsAvailabilityQuery on entity and screen fields
-->

<!-- kumiko-changes
feature: headless
type: improvement
title: Edit view-model carries selectOptionsAvailabilityQuery for multiSelect fields
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: MultiSelect inputs load optionsAvailabilityQuery and hide unavailable options
-->

<!-- kumiko-changes
feature: tenant
type: improvement
title: The member roles form only offers roles the signed-in admin may assign
detail: New query tenant:query:member-role-availability; TenantAdmin still sees every role.
-->
