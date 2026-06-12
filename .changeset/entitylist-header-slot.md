---
"@cosmicdrift/kumiko-renderer": minor
---

entityList rendert jetzt `screen.slots.header`: eine PlatformComponent
(`{ react: { __component: "X" } }`) wird über der Tabelle gemountet,
aufgelöst über dieselbe `ExtensionSectionsProvider`-Registry wie
entityEdit-Extension-Sections. Im Listen-Kontext bekommt die Component
`entityName` + `entityId: null`; nicht registriert → kein Header (kein
Crash). Ermöglicht App-seitige Listen-Header wie einen Cap-Counter, der
seine Daten selbst lädt.
