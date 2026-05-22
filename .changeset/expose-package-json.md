---
"@cosmicdrift/kumiko-framework": patch
---

Expose `./package.json` via subpath export so downstream tooling (publish/materialize, app-templates) can derive the installed framework version at runtime without manual version-pin drift.
