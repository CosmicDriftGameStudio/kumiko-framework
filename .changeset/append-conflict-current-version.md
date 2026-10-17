---
"@cosmicdrift/kumiko-framework": patch
---

A version conflict in append() reports the real stream version and no longer aborts the surrounding transaction

<!-- kumiko-changes
feature: framework
type: fix
title: Append version conflicts carry currentVersion and no longer poison the transaction
detail: |
  append() inserts with ON CONFLICT (tenant_id, aggregate_id, version) DO NOTHING and reads the stream version in the still-intact transaction. VersionConflictError gets an optional currentVersion, and custom writes (ctx.appendEvent, stream.append, appendEventInTenantDb) now answer 409 with the winner's version instead of -1, so a client can rebase. A missing predecessor reports the real stream version too.

  Behaviour change: a lost append race no longer raises a unique violation, so the outer transaction is not aborted (25P02). A handler that catches the VersionConflictError keeps writing and commits. Idempotency-key collisions still throw IdempotentAppendConflictError. Relies on READ COMMITTED, the Postgres default.
-->
