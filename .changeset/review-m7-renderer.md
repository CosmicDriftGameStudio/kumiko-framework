---
"@cosmicdrift/kumiko-renderer": patch
---

List and form renderer fixes: by-id reference lookups stay within the server list limit, the named list filter survives remembered list state, a density change no longer freezes schema pins and widths, group page requests restart on filter change, a live refresh overtaken by a payload change no longer re-queries the old filter, phone header and toolbar controls keep a 44 px touch height, the dropzone holds back submit during image resize, row-hidden attached card cells stay hidden, and several promoted list actions without create collapse into the phone overflow menu.

<!-- kumiko-changes
feature: renderer
type: fix
title: list state, reference lookup, live refresh and upload tracking races fixed
detail: `referenceRowsByIdsPayload` caps `limit` at the server maximum so a field with more than 200 ids still resolves labels. `sanitizeStoredListState` keeps the `filter` param. `useListViewState` stores only pins and widths that differ from the schema defaults, so later schema changes still reach users who only changed density. Group page bridges remount on `resetKey`, `InfinityList` drops its trailing live refresh once its effect is disposed, and `UploadZone` accepts `trackUpload` so the dropzone tracks resize and upload together. Uniform bar controls keep `h-11` below md, embedded card attachments respect `isHiddenInRow`, and two or more promoted toolbar actions without a create button use the phone overflow menu.
-->
