---
"@cosmicdrift/kumiko-bundled-features": minor
---

The delivery log drops its compatibility paths for unmasked legacy events and sort-value-less cursors.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Delivery log no longer re-masks legacy events or accepts old cursors
detail: The delivery-log projection stores the attempt address exactly as the event carries it; attempt events have been masked when written, so the re-masking for older unmasked events on rebuild is gone. `delivery:query:log` answers 400 for a cursor that carries no sort value instead of paging from it.
migration: Clients holding an old cursor reload the first page. Databases with delivery attempt events written before write-time masking must not be rebuilt without re-masking them first.
affects: all
-->
