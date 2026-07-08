---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Content-Tree + Config-Nav Sysadmin-Shell polish:

- text-content: Leaf-Knoten tragen jetzt ein `file`-Icon statt eines Dots; der Editor läuft auf der Page-Shell (`Form`-Primitive mit Card statt des entfernten `FormPanelShell`).
- Sidebar-Nav bekommt ein Suchfeld, das den Baum live filtert (Treffer + ihre Ancestors bleiben, zugeklappte Ordner öffnen für die Suche).
- Ordner-Knoten zeigen `folder-open` wenn ausgeklappt.
- NAV_ICONS um `server`, `mail`, `lock`, `hash`, `download`, `folder-open` ergänzt — SMTP-/Config-Nav-Kinder (z.B. „Email-Versand") rendern damit ein Icon statt blank.
- Verschachtelte Provider-Ordner (Content-Tree) rendern ihre Kinder in einem `<ul>` (valides HTML + Einrück-Stufe pro Tiefe) statt `<li>`-in-`<li>`.
- Platform-Overview: `user:query:user:list` in der Allowlist (behebt den Overview-Crash).
