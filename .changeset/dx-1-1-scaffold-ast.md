---
"@cosmicdrift/kumiko-dev-server": minor
---

scaffoldApp baut `src/run-config.ts` + `bin/main.ts` jetzt via ts-morph
(AST) statt template-strings. Selbes Tool wie scaffoldAppFeature →
ein konsistenter Mechanismus für generate + later modify. Plus:
ts-morph als explicit dependency aufgenommen (war bisher nur via
hoisted root-dep verfügbar; broken bei publish).
