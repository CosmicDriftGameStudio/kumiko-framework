---
"@cosmicdrift/kumiko-renderer-web": minor
---

`SidebarPanel`: zweite Sidebar-Spalte fuer Screens, die eine Liste neben der Navigation brauchen statt im Content — das shadcn-Muster `sidebar-09` (Mail-Client) neben dem `sidebar-07`, das die Shell sonst faehrt.

Ein Screen konnte das bisher nicht bauen: er rendert per Definition im `SidebarInset`, also unter dem ShellHeader, und kommt von dort nicht an eine Spalte, die vom oberen bis zum unteren Fensterrand laeuft. Der Slot dreht die Richtung um — die Shell haelt den Platz, der Screen fuellt ihn per Portal und bleibt sonst ein normaler Screen.

- Verdrahtet in `WorkspaceShell` **und** `DefaultAppShell`.
- Rendert nur, wenn ein Screen den Slot fuellt — kein leerer Streifen auf allen anderen Screens.
- Ohne Slot (Public-Surface, Tests, aeltere Shell) landen die Kinder an Ort und Stelle statt zu verschwinden.
- Breite ziehbar (Default 340px, 260–640), mit optionalem `storageKey` ueber Reloads hinweg.

Ausserdem in `NavTree`: im eingeklappten Zustand wird das Label jetzt ausgeblendet statt nur gekuerzt. `SidebarMenuButton` verlaesst sich auf `truncate`, was nur traegt, wenn ein Icon danebensteht — bei einem Eintrag ohne Icon blieb ein Buchstabenrest in der Rail stehen. Fehlt ein Icon, tritt dort jetzt der Anfangsbuchstabe an die Stelle des Punkts, der eingeklappt nichts aussagt. `icon: "plus"` war importiert, aber nie registriert, und fiel still auf den Fallback zurueck.
