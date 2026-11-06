---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Review round 1, package 8: the WhatsApp webhook normalizer no longer fails a delivery over oversized ids or absurd timestamps, document previews fill their variables, the PWA update drops caches of the unscoped name format, and test runs outside the runner stay marked alive.

<!-- kumiko-changes
feature: channel-whatsapp
type: fix
title: WhatsApp webhook skips oversized ids and survives absurd timestamps
detail: An entry with a wamid or phone number id above its limit is counted as skipped instead of failing the whole delivery with a 5xx. Overlong context ids, media ids and mime types are clipped, and a timestamp beyond the Temporal range falls back to the receive time.
-->

<!-- kumiko-changes
feature: server-runtime
type: fix
title: PWA update removes the precache of the unscoped cache name format
detail: Caches named kumiko-pwa-<16hex> from before the per-scope prefix were never deleted after an update. The service worker now drops them once, and keeps caches of other scopes and foreign libraries.
-->

<!-- kumiko-changes
feature: testing
type: fix
title: Test runs outside the runner stay alive for parallel sweeps
detail: testRunQueueNamePrefix now marks the process run alive, and a failed first alive mark no longer stops the refresh timer, so a parallel run's sweep cannot delete live queues, keys or template databases.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Web preview of document bodies fills the example values
detail: The web preview target sent document bodies with unfilled variable chips. It now fills them with the example values like the snippet preview does.
-->
