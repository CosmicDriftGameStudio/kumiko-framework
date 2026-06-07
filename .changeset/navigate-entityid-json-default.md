---
"@cosmicdrift/kumiko-renderer": patch
---

navigate-Row-Actions: deklarativer entityId-Default für entityEdit-Ziele

`action.entityId` ist eine Function und überlebt JSON-injizierte
Schemas (`window.__KUMIKO_SCHEMA__`) nicht. Zielt die Action auf einen
entityEdit-Screen, greift jetzt `row.id` als Default — der Edit öffnet
auch in JSON-Schema-Apps im Update-Mode statt im Create-Mode.
actionForm-/Custom-Ziele bekommen weiterhin KEINE entityId.
