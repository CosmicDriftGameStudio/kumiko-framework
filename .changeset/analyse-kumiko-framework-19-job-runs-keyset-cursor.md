---
"@cosmicdrift/kumiko-bundled-features": patch
---

`jobs:query:list` pages with a keyset cursor instead of an offset.

<!-- kumiko-changes
feature: jobs
type: fix
title: Job run list pages with a keyset cursor
detail: The offset cursor re-read every run up to the end of the requested page, so deep pages read thousands of rows. The cursor now carries the sort value and id of the last row, and the next page starts right after it. This works for every sort column, including `duration`, where queued and running runs have no value. Cursors from before this change answer 400 `invalid_cursor`, and the client starts again from the first page. Like `jobs:query:details`, the handler reads across tenants through `acknowledgeCrossTenant`, so its escape-hatch audit kind is `acknowledge-cross-tenant` instead of `unsafe-raw`.
-->
