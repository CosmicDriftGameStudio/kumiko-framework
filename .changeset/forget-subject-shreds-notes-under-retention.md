---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject shreds note bodies even when the host entity has anonymize or blockDelete retention

<!-- kumiko-changes
feature: notes-history
type: fix
title: forget-subject shreds note bodies even when the host entity has anonymize or blockDelete retention
detail: |
  Note bodies that @-mention the forgotten subject or hang on it as host entity were skipped when the host entity's retention strategy was anonymize or blockDelete, so the note text stayed readable while the host's own PII fields were anonymized. The note text is free-form PII, and a retention strategy protects the row, not its content, so these bodies are now always crypto-shredded. This applies to the manual `forget-subject` command and to the automated Art. 17 delete hook.
-->
