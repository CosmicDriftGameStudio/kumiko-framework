---
"@cosmicdrift/kumiko-framework": patch
---

Saving an embedded field keeps the sub-field values the writer may not read, and a write response no longer returns fields the writer may not read.

<!-- kumiko-changes
feature: framework
type: fix
title: Saving an embedded field no longer loses sub-field values the writer may not read
detail: The detail query hands a writer embedded rows without the sub-fields whose `access.read` rule he does not pass, and an update replaces the whole embedded value. Saving the rows back therefore deleted those values, and for a file sub-field the file itself. An update of an embedded field (list or single object) now keeps, per row index, the previous value of every sub-field the writer may not read in the previous row when he sends nothing there, or the same file ids for a file sub-field. The read check is the one the query uses. A save fails with a validation error on the field when it sends any other value there, the hidden value itself included so that a save cannot confirm a guess, or would put such a value into a row the writer may read, a row rule over a column he rewrote (`hidden_row_changed`), and when it shortens the list past a row holding such a value (`hidden_row_removed`). Rows have no stable id, so the hidden value stays at its index: a writer without read access who moves a row holding such a value, or inserts or deletes a row before it, gets `hidden_row_changed`, while a list without such a value he still reorders freely. A save that moves such a row and changes its visible content at once is not detected and leaves the hidden value on the row that now stands at its index. Derived cells of the row are computed again with the kept values, so a hidden derived cell no longer blocks the save and a cell derived from a hidden source is no longer stored without it. Writers who may read the sub-field, creates, fields without sub-field read rules and framework system writes that name a `writePurpose` (retention, erasure) behave as before. The check runs for every update through the entity write path, also for other system saves and custom handlers that call it.
migration: A save as a user, or as the system user without a `writePurpose`, that does not pass a sub-field's read rule can no longer change or clear that sub-field; run such writes as a user who may read it. Deleting or moving a row that holds a hidden value, or inserting or deleting a row before it, now needs a writer who may read it.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: A write response no longer returns fields the writer may not read
detail: The response of a write masked only writeOnly fields, so `data`, `changes` and `previous` of a save, the row of a delete, a row returned by a handler and the children of a nested write carried every field and embedded sub-field with an `access.read` rule the writer does not pass. A writer could read such a field by saving the record. The response is now filtered with the same read rules as a query answer, by the entity the executor result names, so also for a handler without an entity in its name or one that returns another entity's save; a rule on `changes` is evaluated against the saved row. Hooks still get the unfiltered result.
migration: Code that dispatches a write and reads a read-restricted field from its result gets that field only when the dispatching user may read it; read it through the executor or as such a user.
-->
