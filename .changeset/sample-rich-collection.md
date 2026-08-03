---
"@cosmicdrift/kumiko-bundled-features": patch
---

use-all-bundled zeigt die Content-Collections jetzt so, wie sie gebaut
sind: `reply-snippets` läuft auf `contentFormat: "rich"` mit
`variableSchema`, beide Collections sind einem Workspace zugeordnet und
der Seed legt zwei Snippets über den Set-Handler an.

Ohne Workspace war keine der beiden Collections in der UI erreichbar,
und ohne `contentFormat` rendert der Editor die Plain-Textarea — der
Rich-Editor mit Toolbar, Chips und Preview war nirgends sichtbar.
