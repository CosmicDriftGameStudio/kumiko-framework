---
"@cosmicdrift/kumiko-bundled-features": patch
---

folder:delete checks the hosts of a folder's assignments with one query per entity type, and folder assignments are indexed by folder.

<!-- kumiko-changes
feature: folders
type: improvement
title: folder:delete checks assignment hosts in batches
detail: `folder:delete` used to look up the host of every assignment on its own inside the write transaction. It now checks each page of assignments with one query per host entity type and still refuses on the first live host, including one the caller cannot see. Assignments of deleted hosts are still removed one by one through the executor. `read_folder_assignments` gets an index on `(tenant_id, folder_id)`, which the delete check and the folder contents list filter on.
migration: Run `kumiko-schema generate` in apps that mount folders and apply the migration that adds the index.
-->
