---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Notes, tags and folders on a `tenancy: "global"` host (such as a helpdesk request) are readable again from a tenant session. Since the system tenant read policy was narrowed, the host check of the parent-ref gate saw no global host row under row level security and hid every such join row.

<!-- kumiko-changes
feature: framework
type: fix
title: parent-ref gate resolves global hosts in the system scope
detail: The parent-ref gate checks a join row's host with an `EXISTS` inside the join table's statement, which runs in the caller's tenant scope. A `tenancy: "global"` host lives on the system tenant and its table is not `systemRowsReadable`, so since the narrowed `kumiko_system_tenant_read` the `EXISTS` found no row: `add-note` passed (the host executor reads a global table in the system scope), but the note list returned nothing, so the helpdesk detail never showed an internal note written from an operator's own tenant. The list, detail and row-readable checks of the event-store executor now resolve global hosts ahead of the statement: one system-scope statement runs the same host check (host tenant, soft delete, the host's `access.read`) for the caller's own join rows only, filtered explicitly to the session tenant and narrowed to the requested row or the host ids a list filter pins, and returns host ids. The gated statement keeps its tenant scope and row level security and matches those ids (`ParentVisibilityOption.globalHostIds`). Paths without that step (reference search and sort, eager loading, derived related fields, readGate links) leave the global host arm out, so they deny instead of widening.
-->
