---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Tests no longer write kumiko_events or membership projections by hand

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Tests seed tenant memberships and events through the framework
detail: Test-only change. Integration tests create read_tenant_memberships from tenantMembershipEntity and seed rows with seedRow instead of hand-written DDL and raw INSERTs. Fake events go through the event-store append, and backdated audit events are written with runSeedWritesAt instead of an UPDATE on created_at. No runtime behavior changes.
-->
