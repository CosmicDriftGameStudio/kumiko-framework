---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

clientAction row actions backed by a client registry

A row action with `kind: "clientAction"` runs a function from a client bundle instead of a write handler. The schema carries `action: "<feature>:<kebab>"`; a client feature registers the function under `ClientFeatureDefinition.clientActions` (merged like `columnRenderers`, last wins with a warning). The handler gets the payload (default `{ id: row.id }`, or the `payload` extractor) and returns `{ ok: true }` or `{ ok: false, message }`. Success shows a toast (`successMessage`, default "Done.") and refetches, a failure shows an error toast, and a throw or an unregistered name shows a generic one and logs the name. `confirm`, `confirmLabel`, `style: "danger"`, `visible`, `icon` and `display` work as on a write handler; `redirect` and `rowClick` do not exist. Toolbar actions do not take it. Boot rejects a name that is not `<feature>:<kebab>`.

auth-email-password registers `auth-email-password:request-password-reset` and `auth-email-password:request-email-verification`, both taking `{ email }`.

<!-- kumiko-changes
feature: framework
type: improvement
title: clientAction row actions
detail: RowAction gains kind "clientAction" with a client-registered handler name; boot rejects a name that is not <feature>:<kebab>, and the surface keys include its confirm, confirmLabel and successMessage.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Client action registry for row actions
detail: ClientActionsProvider, ActionNoticeProvider and runClientAction execute clientAction row actions on list, related list and record actions, with confirm, toast feedback and refetch.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: ClientFeatureDefinition.clientActions
detail: Client features register clientAction handlers; createKumikoApp merges them and shows their outcome as toasts.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Client actions for password reset and email verification
detail: emailPasswordClient registers auth-email-password:request-password-reset and auth-email-password:request-email-verification for clientAction row actions.
-->
