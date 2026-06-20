---
"@cosmicdrift/kumiko-bundled-features": patch
---

sessions: `read_user_sessions` nicht mehr als rebuildbare Implicit-Projection registrieren

Die Tabelle ist ein Hot-Path-Direct-Write-Store — `sessionCreator` legt Rows per `insertOne` an und die Revoke-Handler updaten sie, beides **ohne** Lifecycle-Event. Als `r.entity` registriert wurde sie zur rebuildbaren Implicit-Projection, deren Replay null `user-session.*`-Events findet und einen leeren Shadow über die Live-Tabelle swappt — jeder Projection-Rebuild (Deploy / `schema apply`) löschte still **alle aktiven Sessions** (Mass-Logout, revoked-State weg). Fix: `r.unmanagedTable(buildEntityTableMeta(...))` behält die Migration-DDL, nimmt die Tabelle aber aus dem Implicit-Rebuild — analog zu `jobs`/`channel-in-app`/`feature-toggles`, die ebenfalls Direct-Write-Stores sind. (#498/#494)
