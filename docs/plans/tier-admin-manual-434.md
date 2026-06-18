---
status: in-progress
verified: 2026-06-18
next: Phase A KOMPLETT (Branch feat/tier-admin-434) — Server-Kern + TierAdminScreen + tierEngineClient + package.json-subpath + Integration-Test (16 grün, Scenario 7 cross-tenant) + changeset (minor, lockstep). Offen Phase B (npm-Release), dann C (money-horse → ab da auf cashcolt testbar), D, E.
issue: CosmicDriftGameStudio/kumiko-framework#434
---

# tier-engine: manuelles Tier-Zuweisen (Admin-UI ohne Billing) — #434

Ein SystemAdmin weist einem Tenant über die UI ein Tier zu, **ohne Stripe-Kauf**,
**general für alle Apps** (money-horse, publicstatus, studio). Logik + UI leben
einmal im bundled-feature `tier-engine`; jede App schaltet mit ~3-5 Zeilen frei
(`r.nav` + Client-Feature in der Liste). Unblockt das Testen der >Free-Features.

## Verifizierter Ist-Zustand (Code gelesen 2026-06-18)

- **Entity** `tier-engine/entity.ts:25` — `read_tier_assignments`, nur Feld `tier`
  (`createTextField maxLength 50`). `tenantId` = Base-Column (tenant-scoped projection).
  **Ein Aggregat pro Tenant**, deterministisch via `tierAssignmentAggregateId(tenantId)`
  (uuidv5, `aggregate-id.ts`). Standard-CRUD vergibt aber `gen_random_uuid()` — die
  deterministische ID nutzt nur der auto-default-Hook.
- **Write-Handler** `feature.ts:179-180` — `defineEntityCreate/UpdateHandler`,
  SystemAdmin-only (`writeAccess`). **Schreiben nur auf `ctx.tenantId`** (eigener
  Tenant) → für cross-tenant NICHT verwendbar.
- **Cross-tenant-Write-Muster EXISTIERT** im auto-default-Hook (`feature.ts:294-305`):
  `tierAssignmentExecutor.create({ id: tierAssignmentAggregateId(target), tier }, systemUser{id, tenantId: target, roles:["SystemAdmin"]}, createTenantDb(rawDb, target, "system"))`.
  `rawDb` via `"raw" in ctx.db` TypeGuard. **Das ist die Vorlage für set-tenant-tier.**
- **Read** `handlers/active-tier.query.ts` — `get-active-tier`, nur eigener Tenant
  (kein tenantId-Param). Cross-tenant-Read fehlt.
- **tierMap** = Server-Closure in `createTierEngineFeature(opts)` (`feature.ts:194`).
  Client-Screen kommt NICHT direkt dran → Query-Handler `tier-options` nötig.
- **Tenant-Liste** für die Auswahl: bestehende `tenant:query:list` (SystemAdmin-only)
  wiederverwenden — VERIFY Signatur vor Nutzung.
- **r.describe** `feature.ts:170` — erweitern.
- **Screen-Typ:** Issue verlangt **custom React-Screen** (`type: "custom"`,
  `renderer.react.__component`), NICHT entityEdit (cross-tenant + Tenant-Picker +
  tierMap-Dropdown gehen mit entityEdit nicht). Vorbild Registrierung: `managed-pages`.
- **Client-Export-Muster:** `text-content/web/client-plugin.tsx` → `tierEngineClient(): ClientFeatureDefinition`.
  Neuer subpath-export `"./tier-engine/web"` in `bundled-features/package.json` nötig.

## Phasen

### A — Framework-Kern (eigener Branch, lokal committen)
- [x] `entity.ts`: Feld `source: createTextField({ required:false, maxLength:20 })` ✅ c0c84ef2
      (Werte `"manual"|"stripe"|"default"`). TODO: prüfen ob ein Entity-/Drift-Pin-Test im
      tier-engine das Feld kennen muss (feature.test.ts pinnt die aggregate-id-Konstante, nicht die Felder).
- [x] auto-default-Hook: `create({ id, tier, source:"default" })`. ✅ c0c84ef2
- [x] Write-Handler `tier-engine:write:set-tenant-tier` (`handlers/set-tenant-tier.write.ts`) ✅ c0c84ef2.
      **VERIFIZIERTE cross-tenant-Mechanik (kritisch für Test/Screen):** das set.write-
      "override-user"-Muster (ctx.db + executorUser.tenantId=override) trägt NUR für
      `SYSTEM_TENANT_ID` (immer im Tenant-IN-Filter, executor-list.ts:41-44 greift nur bei
      `db.mode==="tenant"`). Für BELIEBIGE Tenants braucht es: `rawDb = ctx.db.raw` →
      `createTenantDb(rawDb, target, "system")` (mode≠tenant ⇒ kein Filter, tenant-db.ts:141/162)
      → `executor.create/update(..., systemUser{tenantId:target}, tdb)`. Upsert via
      `fetchOne(tdb, table, {tenantId})` → vorhanden? update(existing.id, existing.version) :
      create(id: `tierAssignmentAggregateId(target)`). `source:"manual"`.
- [x] Read-Handler `tier-engine:query:get-tenant-tier` (`handlers/get-tenant-tier.query.ts`) ✅
      + `tier-options` inline in feature.ts (Closure → `opts.tierMap ? Object.keys : []`). Beide
      SystemAdmin. get-tenant-tier nutzt dasselbe system-mode-tdb-Muster für cross-tenant-Read.
- [x] `web/tier-admin-screen.tsx` (custom React): Tenant-Picker (`tenant:query:list`) →
      aktuelles Tier (`get-tenant-tier`) → Dropdown (`tier-options`) → Speichern
      (`set-tenant-tier`). usePrimitives(Section/Field/Input select/Banner/Button/Heading) +
      useDispatcher/useQuery/useTranslation. testId + i18n-Keys (de/en). Reset-on-Tenant-Wechsel
      (biome-ignore useExhaustiveDependencies = gewollter Trigger).
- [x] `r.screen({ id:"tier-admin", type:"custom", renderer:{react:{__component:"TierAdminScreen"}}, access:{roles:["SystemAdmin"]} })`
      in `createTierEngineFeature` (VOR dem tierMap-Early-Return → Screen immer da). KEIN `r.nav`.
- [x] `web/index.ts` + `web/client-plugin.tsx` `tierEngineClient()` (components:{[tier-admin]:TierAdminScreen}, translations).
      Screen-Lookup per Screen-id, nicht __component-String (money-horse/web.tsx-Konvention).
- [x] `bundled-features/package.json`: export `"./tier-engine/web"`.
- [x] `r.describe` um Admin-Grant + `source` erweitern. ✅ c0c84ef2
- [x] Handler in `feature.ts` registriert (setTenantTierWrite, getTenantTierQuery, tier-options). ✅ c0c84ef2 — tsc/biome grün.
- [x] **Integration-Test:** Scenario 7 (4 Tests) in tier-engine.integration.test.ts: SystemAdmin
      setzt fremden Tenant (Event im Ziel-Stream via get-active-tier AS target bewiesen, Admin-Tenant
      bleibt null), `source:"manual"`, upsert idempotent (isNew false + tier-update), TenantAdmin +
      User fail-closed (write + get-tenant-tier 403). 16 Integration- + 3 Drift-Tests grün (40 total).
- [x] Drift-Pins für die 3 neuen QNs (Screen↔Handler-Contract).
- [x] Changeset `.changeset/tier-engine-manual-grant.md` (minor, bundled-features → framework lockstep via fixed).
- [x] **Effective-Set-Fix (Advisor-Finding):** Feature-Gate liest den Resolver-Cache, nicht die
      Projektion. set-tenant-tier schreibt direkt über den Executor → postSave-Hook feuert NICHT →
      Grant hätte nur die Projektion geändert, nicht das effektive Set (kosmetisch bis Prozess-Neustart).
      40 grüne Tests hatten das verfehlt (alle prüften stored, nicht effective). Fix: Write-Handler =
      Factory `createSetTenantTierWrite({ onAssigned })`, feature.ts hängt im tierMap-Block denselben
      Cache-Update wie der Hook ein (storage-only = no-op). Diskriminierender Test resolver.integration
      (4): stale-Upgrade free→pro via set-tenant-tier → resolver(A).has("feat-pro") muss true werden.
      Cache-miss-Fallback rettet nur cache-MISS (neuer Tenant), nicht stale (Upgrade). Multi-Pod-
      Invalidation bleibt vorbestehende tier-engine-Grenze (single-pod cashcolt ok).

### B — Release
- [ ] Publish auf npmjs (Rezept: shallow-clone→/tmp→frozen→tsc, changeset-Bot-PR
      close/reopen für CI, PRE_PUSH_SKIP). Siehe Memory `project_kumiko_055_release_consumer_bumps`.

### C — money-horse-Verdrahtung (→ ab hier auf cashcolt testbar)
- [ ] Bump `@cosmicdrift/kumiko-bundled-features` + `@cosmicdrift/kumiko-framework`.
- [ ] `tierEngineClient()` in `createKumikoApp({ clientFeatures })` (src/client.tsx o.ä.).
- [ ] `r.nav({ screen:"tier-engine:screen:tier-admin", parent:"money-horse:nav:...", ... })`
      — **qualifizierte Refs Pflicht** (Dev validiert nicht → sonst prod-CrashLoop).
- [ ] Migration: `bunx kumiko-schema generate` + `.snapshot.json` mit-committen, dann apply.
- [ ] i18n + Coverage-Test. **Boot-Validate** (`bin/main.ts` lokal gegen Wegwerf-DB).

### D — publicstatus + studio
- [ ] Gleiche 5 Schritte wie C je App.

### E — Doku
- [ ] `r.describe` (schon in A) → `docgen` regeneriert `tier-engine.mdx`.
- [ ] Kuratierte How-to-Seite (`kumiko-platform/.../bundled-features/tiers.md` o. operations.md):
      „Tier manuell zuweisen ohne Billing". Code-Blöcke als `file=`-Embed aus Recipe
      `samples/recipes/tier-admin/` ODER ` ```ts illustration ` — sonst CI check-embeds rot.
- [ ] `bun run gen:manifest` (use-all-bundled) + `kumiko docgen`.

## ⚠️ Sicherheit
- Write-Handler SystemAdmin-only bleiben (TenantAdmin = Self-Upgrade-Schutz).
- set-tenant-tier schreibt cross-tenant → Access-Gate ist die einzige Schranke, fail-closed.
  Integration-Test MUSS Nicht-SystemAdmin-Verweigerung belegen (kein Tenant-Leak).
- `source:"manual"` schützt manuelle Grants vor späterem Stripe→Tier-Sync (Webhook darf
  Admin-Grant nicht plätten). Von Anfang an mitführen.

## DoD (aus #434)
Alle Boxen oben + Einbindung in **alle 3 Apps** + Doku (docgen + check-embeds grün) +
Changeset/Release + Consumer-Bumps.
