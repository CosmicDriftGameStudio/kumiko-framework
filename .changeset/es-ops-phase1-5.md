---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

feat(es-ops): Phase 1.5 — tenantIdOverride + dry-run-validator + E2E-Test + Doku

Phase 1.5 schließt die Lücken aus Phase 1 die den ersten Driver-Use-Case
(publicstatus admin-roles) blockten. Siehe Retro:
`kumiko-platform/docs/plans/features/es-ops-phase1-retro.md` (PR #9).

**A1 — tenantIdOverride:**
`SeedMigrationContext.systemWriteAs(qn, payload, tenantIdOverride?)`.
Default SYSTEM_TENANT_ID (unverändert für System-scope-Aggregates wie
config-values). Mit override: `createSystemUser(tenantIdOverride)` als
Executor, damit der Event-Store-Executor den Aggregate-Stream im
richtigen Tenant findet. Fix für die `version_conflict`-Klasse-Bug
(Memory `feedback_event_store_tenant_consistency.md`).

**A2 — dry-run-validator:**
Runner parsed seed-files vor `migration.run()` per regex
`systemWriteAs\(["']([^"']+)["']`, sammelt handler-QNs, validiert
gegen `registry.getWriteHandler(qn)`. Fail-fast mit klarer Message
+ Datei + QN statt zur Runtime "handler not found". Catched camelCase-
typos (kebab-case-vs-camelCase Drift) + andere QN-Drift zur Boot-Zeit.
runProdApp reicht den richtigen Registry rein (`registry` neu in
RunPendingSeedMigrationsArgs).

**A3 — E2E-Test:**
`packages/bundled-features/src/__tests__/es-ops-e2e.integration.ts`
mit `setupTestStack`-Pattern: tenant+config Features echt geladen,
echtes Membership-Aggregate via TenantHandlers.addMember im Demo-Tenant,
seed-migration ruft update-member-roles mit tenantIdOverride → write
geht durch, Marker landed, Event in Store, Read-Model aktualisiert.
Plus typo-Test: seed mit camelCase fail-t Dry-Run mit
`/dry-run found.*unknown handler-QN/`. **TDD-First**: ohne A1+A2 wäre
der test rot.

**A4 — Doku:**
`framework/src/es-ops/README.md` erweitert um „Wann brauche ich
tenantIdOverride?" + „Deployment-Anforderungen" (Docker COPY, Idempotenz,
Multi-Replica) + „Lokaler Smoke vor Push". Recipe-README + seed-files
auf neue API aktualisiert.

**A5 — Smoke-Skript-Template:**
`samples/recipes/seed-migration/scripts/smoke.ts` als copy-paste-Template
für App-Authors: Bun-runnable, offline (read-only, kein DB-Write),
validiert Module-Load + QN-Resolution + System-User-Access. Recipe-
README dokumentiert Pflicht-Pattern.

**Bonus-Fix:**
`tenant:write:create`-access auf `["system", "SystemAdmin"]` erweitert
(symmetrisch zu update-member-roles). Aufgedeckt durch Recipe-Smoke +
initial-tenants-Seed. Pinning-Test in `tenant.integration.ts` updated.

**Test-State:** 45/45 grün (Pre-Push). Typecheck clean. Biome clean.
as-cast-Audit clean. Guard-silent-skip clean. Recipe-Smoke clean.

**Folge-Step (separater PR):** publicstatus driver-sample reaktivieren
mit lokalem Pre-Push-Smoke gegen publicstatus' echtes Feature-Set.
