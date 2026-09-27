---
"@cosmicdrift/kumiko-bundled-features": minor
---

Ledger accounts declare a partial unique index on `(tenantId, code)`

<!-- kumiko-changes
feature: ledger
type: breaking
title: Account code is unique per tenant (partial unique index read_ledger_accounts_tenant_id_code_uidx)
detail: |
  `accountEntity` declares `read_ledger_accounts_tenant_id_code_uidx`, a unique index on `(tenant_id, code)` that only covers accounts with a code. Two parallel find-then-create calls for the same code (two tabs, two devices) could each create an account and leave a tenant with duplicate codes. The second write now fails with `unique_violation` (HTTP 409). This applies to `createAccount` and to an `updateAccount` that changes the code. Accounts without a code are unaffected, and the same code in different tenants stays allowed.
migration: |
  Before you apply the migration, check for existing duplicates:

    SELECT tenant_id, code, count(*) FROM read_ledger_accounts
    WHERE code IS NOT NULL GROUP BY tenant_id, code HAVING count(*) > 1;

  `kumiko schema generate` treats a new unique index on a managed projection as destructive. It emits DROP TABLE + CREATE TABLE plus a `.rebuild.json`, which means a full event replay of `read_ledger_accounts`. A rebuild creates the table's indexes before it replays. So if a tenant's event history ever contained two accounts with the same code at the same time, the replay hits the unique index and fails, even after one of them was renamed. For an app with existing ledger data, hand-edit the generated migration before committing it. Replace the DROP/CREATE with an in-place

    CREATE UNIQUE INDEX IF NOT EXISTS "read_ledger_accounts_tenant_id_code_uidx"
      ON "read_ledger_accounts" ("tenant_id", "code") WHERE "code" IS NOT NULL;

  and delete the `.rebuild.json`. The migrations snapshot stays as generated. If the duplicate check found rows, resolve them first through real writes, for example an `updateAccount` that gives the extra account another code. Never edit the table directly. For such a tenant, a later full rebuild of `read_ledger_accounts` still replays the historical duplicate and fails. An app that already created this index by hand under the same name (money-horse migration 0024) gets a no-op from the in-place statement.

  Code that does find-then-create by code should expect `unique_violation` on create and re-read the account that won the race.
-->
