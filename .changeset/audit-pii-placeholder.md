---
"@cosmicdrift/kumiko-bundled-features": patch
---

Audit log list/details (and the own-history self-disclosure) work under an active subject KMS: PII ciphertext in event payloads is replaced by the placeholder `[[personal data]]` instead of being rejected by the API leak guard.

<!-- kumiko-changes
feature: audit
type: fix
title: Audit log works under an active subject KMS
detail: audit list, audit details and user-data-rights my-audit-log returned event payloads as stored. With a subject KMS configured the payload carried kumiko-pii ciphertext and the API leak guard answered 500 pii_ciphertext_leak. Every PII ciphertext string in the payload is now replaced by REDACTED_PII_PLACEHOLDER ("[[personal data]]"); the audit log still never shows plaintext PII.
-->
