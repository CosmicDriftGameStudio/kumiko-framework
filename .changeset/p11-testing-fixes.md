---
"@cosmicdrift/kumiko-testing": patch
---

`kumiko-testing bunfig` now reports dotted and quoted keys as unknown and keeps `[[array-of-tables]]` blocks instead of folding them into `[test]`, and drops the superseded `./test-setup/dom.preload.ts` only when the DOM preload is generated. The schema-env-defaults preload treats empty values like unset ones for every key. `kumiko-testing integration <dir>` skips `node_modules`, `dist` and `e2e` while expanding a directory. `seedTenant` returns `unsubscribeSse` to detach the tenant's SSE client from `events.sse`. A real-provider scenario `waitFor` now times out after `E2E_TIMEOUT_MS.realWait` (180 s), before the 240 s test timeout.

<!-- kumiko-changes
feature: testing
type: fix
title: bunfig merge reports dotted/quoted keys and keeps array tables, empty schema env defaults are replaced, integration dir expansion prunes node_modules, seedTenant gains unsubscribeSse
-->
