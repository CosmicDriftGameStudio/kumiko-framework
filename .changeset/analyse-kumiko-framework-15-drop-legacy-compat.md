---
"@cosmicdrift/kumiko-bundled-features": minor
---

The delivery log drops its compatibility path for sort-value-less cursors; re-masking of legacy events and the drain of old queued jobs stay.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Delivery log no longer accepts old cursors
detail: `delivery:query:log` answers 400 for a cursor that carries no sort value instead of paging from it. The delivery-log projection still masks recipient addresses of attempt events written before write-time masking when it is rebuilt. Queued notifications are delivered by one sealed `delivery.send` job; jobs queued by earlier versions (`delivery.render`, and `delivery.send` with `address`/`sealedAddress`) are still processed so a deploy does not fail them.
migration: Clients holding an old cursor reload the first page.
affects: all
-->
