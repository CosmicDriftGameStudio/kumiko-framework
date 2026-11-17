---
"@cosmicdrift/kumiko-bundled-features": minor
---

Audit queries show an event payload only as far as the caller may read the entity.

<!-- kumiko-changes
feature: audit
type: breaking
title: Audit payloads follow the entity read rules; payload can be null
detail: `audit:query:list`, `details`, `list-all-tenants` and `details-all-tenants` checked only the tenant and redacted PII ciphertext, so a TenantAdmin read plaintext fields of entities restricted to another role. Now `payload` is `null` when the caller lacks the entity's query access, when the entity's `access.read` grants none of the caller's roles `"all"`, or when the entity has a `readGate` or `parentRef`. Otherwise writeOnly fields and fields whose read rule grants none of the caller's roles `"all"` are removed from the snapshot and from `changes` and `previous`. Other events on such an aggregate have their payload withheld if the entity has a field restricted for the caller. The rules apply to SystemAdmins too.
migration: Code that reads `payload` from audit rows must handle `null`.
-->
