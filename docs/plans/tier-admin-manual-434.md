---
status: in-progress
verified: 2026-06-18
next: Phase A starten (Framework-Kern) — nach /compact, eigene frische Session
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
- [ ] `entity.ts`: Feld `source: createTextField({ required:false, maxLength:20 })`
      (Werte `"manual"|"stripe"|"default"`). Drift-Pin-/Entity-Test ggf. anpassen.
- [ ] auto-default-Hook (`feature.ts:301`): `create({ id, tier, source:"default" })`.
- [ ] Neuer Write-Handler `tier-engine:write:set-tenant-tier` — Payload `{ tenantId, tier }`,
      SystemAdmin-only, **cross-tenant via Executor-Muster** (s.o.), `source:"manual"`,
      **upsert**: `getAggregateStreamMaxVersion(rawDb, aggId) > 0 ? executor.update : .create`.
      `aggId = tierAssignmentAggregateId(tenantId)`.
- [ ] Neuer Read-Handler `tier-engine:query:get-tenant-tier` — `{ tenantId }`, SystemAdmin,
      cross-tenant (selectMany/queryProjection auf Ziel-Tenant). Plus `tier-options`
      (Closure → `Object.keys(tierMap)`, SystemAdmin).
- [ ] `web/tier-admin-screen.tsx` (custom React): Tenant-Picker (`tenant:query:list`) →
      aktuelles Tier (`get-tenant-tier`) → Dropdown (`tier-options`) → Speichern
      (`set-tenant-tier`). usePrimitives/useDispatcher/useQuery. testId + i18n-Keys (de/en).
- [ ] `r.screen({ id:"tier-admin", type:"custom", renderer:{react:{__component:"TierAdminScreen"}}, access:{roles:["SystemAdmin"]} })`
      in `createTierEngineFeature`. KEIN `r.nav` (App-Sache).
- [ ] `web/index.ts` + `tierEngineClient()` (components:{TierAdminScreen}, translations).
- [ ] `bundled-features/package.json`: export `"./tier-engine/web": "./src/tier-engine/web/index.ts"`.
- [ ] `r.describe` um Admin-Grant + `source` erweitern.
- [ ] **Integration-Test:** SystemAdmin setzt Tier eines fremden Tenants ohne Subscription;
      Nicht-SystemAdmin → verweigert (fail-closed); `source:"manual"` gesetzt; upsert idempotent.
- [ ] Changeset (bundled-features + framework im Gleichschritt, fixed). `tsc`/biome/tests grün.

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
