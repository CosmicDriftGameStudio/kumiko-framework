---
"@cosmicdrift/kumiko-bundled-features": patch
---

notes-history: `add-note` now rejects `mentions` of users who are not members of the current tenant, because their forget run only visits tenants they belong to and would never reach such a note. The notes-history user-data export hook now lists the notes that mention the exporting user.

<!-- kumiko-changes
feature: notes-history
type: improvement
title: add-note rejects mentions of non-members; mention export lists mentioning notes
migration: |
  No action needed unless a client mentions user ids that are not members of the tenant; those writes now fail validation.
-->
