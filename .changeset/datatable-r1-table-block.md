---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

List screens get a `table` block: remembered filter, search and sort per user, a reset-all button, a column picker with reordering, and a comfortable or compact row density.

<!-- kumiko-changes
feature: framework
type: improvement
title: table block on entityList, projectionList and relatedList
detail: The new optional table block (rememberState, resetAll, columnPicker, density with default and userChoice) is validated at boot; unknown keys, hidden columns without columnPicker and invalid density values are rejected. Columns accept hidden: true. Remembered state lives in sessionStorage per tenant and user and is cleared on logout or identity change.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: DataTable view menu, remembered list state and compact density
detail: Lists with a table block show a view menu (columns, density, reset view) and a reset-all button. Remembered query parameters are copied into the URL once; links with explicit parameters win. Compact density uses 32px rows with 4px cell padding. New keys kumiko.list.reset-all and kumiko.list.view.* in all locale packages.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: CurrentUser carries tenantId, logout clears remembered list state
detail: The session CurrentUser has an optional tenantId used to scope remembered list state; logout removes all kumiko.list.* storage entries.
-->
