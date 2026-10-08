---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

Tenant names are PII encrypted under the tenant record and crypto-shredded on tenant destroy

`tenant.name` is now `personal: { of: "id" }`, so it is stored as `kumiko-pii:` ciphertext in events and in `read_tenants`. Signup no longer writes the email into the tenant name; it uses the generated tenant key. The tenant destroy job erases the tenant record key and purges the tenant's search documents. The tenant queries (`me`, memberships, tenant-directory, user list, cap-overview, tenants-missing-profile) decrypt the name, and the tenant list sorts by `key` because encrypted names are not sortable.

<!-- kumiko-changes
feature: tenant
type: breaking
title: Tenant names are encrypted under the tenant record and crypto-shredded when the tenant is destroyed
migration: After the bump run the PII backfill (backfillEventPiiEncryption), then rebuild the read_tenants projection; the backfill only encrypts event payloads. Raw reads of read_tenants.name in apps now return ciphertext and must go through decryptStoredPii or the tenant query handlers. Tenants that were already destroyed (read_tenants.destroyed_at set) get the erased sentinel instead of a fresh record key.
-->
