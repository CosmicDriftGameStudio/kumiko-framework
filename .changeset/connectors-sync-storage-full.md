---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The connector list says why a satellite is not syncing when its upload was refused for lack of storage; the pairing link a satellite shows opens the pair screen in an app with workspaces.

<!-- kumiko-changes
feature: connectors
type: improvement
title: The connector list shows "Storage full, uploads paused"
detail: When an upload is refused with `507 storage_quota_exceeded`, the device remembers it (`quotaRejectedAt`) and the "Details" column of its connector says "Storage full, uploads paused" until the next upload of that device is accepted. The server decides this, so no satellite update is needed. New column on `store_connector_devices`: run the migration `0073_connectors-quota-rejected`.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: A link to a screen without workspace prefix opens that screen
detail: In an app with workspaces, `/<screenId>` (for example the connectors pairing link `/connector-pair`) was read as an unknown workspace and ended on the default screen. The shell now moves it to the active workspace and keeps the query.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: A form screen can name the fields a plain link may fill
detail: An `actionForm` takes `linkPrefillFields: ["userCode"]`. A link such as `/pair?userCode=AB12-CD34` then fills exactly these fields, each value coerced by its field type; every other query key is ignored, and nothing is submitted by the link. Until now only navigate `params` and `redirect.handOff` could allow URL prefill. Boot rejects a name that is no field of the form (`form/link-prefill-unknown-field`).
-->

<!-- kumiko-changes
feature: connectors
type: improvement
title: The satellite can offer a link that opens the pair screen with the code filled in
detail: `POST /v1/device_authorization` also answers `verification_uri_complete` (`verification_uri` plus `?userCode=<code>`, RFC 8628 section 3.3.1). The pair screen fills the code from it; the admin still presses Check, and confirming stays bound to that Check by the same admin within 5 minutes.
-->

<!-- kumiko-changes
feature: connectors
type: fix
title: The confirm step shows the requesting address readably
detail: A request from an IPv6 address is shown as its /64 prefix in compact form (`2001:db8:1:2::/64`), and a request from this very server as "local (this server)", instead of `0:0:0:0::/64`. IPv4 is unchanged. Action form facts take `valueIsI18nKey` to show a translated value.
-->
