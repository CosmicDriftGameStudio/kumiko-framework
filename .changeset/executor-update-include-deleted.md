---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Executor update accepts includeDeleted for soft-deleted rows

`executor.update(payload, user, db, { includeDeleted: true })` loads the row without the soft-delete filter (the tenant filter stays), so server code can move a trashed row together with its parent (for example a team change) and a later restore lands consistently. The row stays deleted. The default is unchanged (NotFound) and the generic HTTP update handler never sets the option. The projection apply was already unfiltered by `isDeleted`, so live and rebuild agree.

<!-- kumiko-changes
feature: framework
type: improvement
title: Executor update accepts includeDeleted for soft-deleted rows
-->
