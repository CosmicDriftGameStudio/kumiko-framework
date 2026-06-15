---
"@cosmicdrift/kumiko-renderer-web": minor
---

App-Shell: optional `fill` + Sidebar-Nav-Icons.

- `AppLayout` und `DefaultAppShell` bekommen ein optionales `fill?: boolean`.
  `fill` → Wurzel `h-screen` (fixe Viewport-Höhe), Sidebar/Topbar bleiben
  stehen, der Main-Bereich scrollt INNEN (`min-h-0` + `overflow-auto`) statt
  der ganzen Seite. Default (`false`) bleibt der bisherige `min-h-screen`-Flow
  — bestehende Apps ändern sich nicht. Clippt nie (Content scrollt in `main`).
  Plus `className`/`mainClassName` als Erweiterungspunkte (cn-merge).
- `NavTree` rendert jetzt Icons: ein Nav-Eintrag mit `icon: "<key>"` zeigt das
  passende lucide-Icon vor dem Label (vorher nur ein Punkt). Kuratierte
  Registry (`dashboard`, `list`, `calculator`, `wallet`, `sparkles`, …);
  unbekannte Keys fallen sauber auf den Punkt zurück (kein Boot-Fail).
