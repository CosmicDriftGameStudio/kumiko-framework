---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
---

Workspace-Navigation + Row-Action-Fehler sichtbar machen

- `useBrowserNavApi` honoriert jetzt den dokumentierten NavTarget-Contract:
  `workspaceId` weglassen = aktueller Workspace bleibt. Vorher erzeugte
  `navigate({ screenId })` im Workspace-Mode einen Pfad ohne Workspace-
  Prefix, `parsePath` las das Screen-Segment als Workspace-Id und
  `WorkspaceShell` revertete sofort auf den Default-Screen — Edit-/
  Toolbar-Navigate-Aktionen wirkten tot.
- `RowActionNavigate` hat ein neues optionales `entityId(row)`:
  entityEdit-Targets bekommen die Id als Pfad-Segment (`route.entityId`),
  `?id=`-Search-Params öffneten den Edit-Screen im Create-Mode.
- navigate-Row-Actions setzen Search-Params jetzt NACH `nav.navigate`
  (pushState trägt keine Query — vorher gesetzte Params klebten an der
  alten URL, actionForm-Prefill kam leer an).
- Row-Action-Writes verwerfen Failure-Results nicht mehr:
  `WriteFailedError` (neu exportiert, inkl. `dispatcherErrorText`) wird
  geworfen und im Web-Renderer als destructive Toast gezeigt (inkl.
  docsUrl). Vorher schloss der Confirm-Dialog kommentarlos — "Klick tut
  nichts". Confirm-Dialoge schließen außerdem auch bei rejected
  onConfirm statt offen zu hängen.
