---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-headless": minor
---

Review-Findings Rest-Welle (PR #323, 35 Findings). Verhaltens-relevant:

- **Boot strenger** (kann bisher durchlaufende Boots brechen): required
  Config-Keys mit computed bzw. non-empty default sind jetzt Boot-Fehler;
  Action-Field-Refs (pick/map/visible.field/entityId) werden gegen die
  Entity-Felder validiert; zwei Entities mit gleichem tableName werfen.
- **readiness:** SystemAdmin-gated required-Keys zählen jetzt im Verdict
  jedes Callers (skipAccessFilter im Rollup) — `ready` kann von true auf
  false kippen, wo vorher Lücken unsichtbar waren; mail-foundation
  Provider-Key ist required.
- **access.admin-Preset** enthält zusätzlich `TenantAdmin`.
- **user-data-rights:** runForgetCleanup wählt savepoint-FIRST — nested
  BEGIN in Transaktionen (Prod-Incident-Klasse) behoben.
- **dev-server:** `extraRoutes`-deps zwischen runProdApp und
  createKumikoServer geteilt (`ExtraRoutesSystemDeps`); createKumikoServer
  reicht jetzt den nackten ioredis-Client statt des TestRedis-Wrappers.
- **renderer-web:** Theme-Restore concurrent-render-sicher (useState-Lazy);
  ConfigSourceBadge kollabiert Operator-Quellen auf Tenant-Screens.
- **renderer/headless:** evalFieldCondition als Single-Source re-exportiert.
