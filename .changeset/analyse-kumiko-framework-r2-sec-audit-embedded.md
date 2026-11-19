---
"@cosmicdrift/kumiko-bundled-features": patch
---

Audit payloads withhold embedded fields that hold a sub-field the caller may not read.

<!-- kumiko-changes
feature: audit
type: fix
title: Audit hides embedded fields with restricted sub-fields
detail: An embedded or embedded-list field whose schema has a sub-field with an access.read rule that grants none of the caller's roles "all" is removed from the audit snapshot, changes and previous, the same as a restricted top-level field. Before, such sub-fields showed in plaintext.
-->
