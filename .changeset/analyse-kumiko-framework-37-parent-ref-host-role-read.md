---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Notes, tags, documents and other join rows are only visible to roles that may query their host entity.

<!-- kumiko-changes
feature: parent-ref
type: breaking
title: Join rows respect the host's query roles
detail: The parentRef gate and the write-side checks (`parentRowIsVisible`, `visibleParentRowIds`) only checked the host row's row-level read rules. A role without any query handler access to the host could still list and add notes, tags or documents on it. A host with query handlers now also requires that one of them grants the viewer's roles; a host without query handlers is decided by row rules as before. New export `hostRoleAllowsRead` from the engine and new field `ParentVisibilityOption.canReadHostByRole`.
migration: Roles that should see join rows on a host need access to one of the host's query handlers. Custom `ParentVisibilityOption` objects can set `canReadHostByRole`.
-->
