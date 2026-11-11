---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
---

The `bun dev` welcome banner is in English, and booting a persistent dev DB no longer logs one line per projection table that already exists.

<!-- kumiko-changes
feature: dev-server
type: fix
title: English welcome banner and a quieter dev boot
detail: The welcome banner of scaffolded apps mixed German and English ("kumiko-app läuft", "Login als"). It now reads "Kumiko app running", "Login" and "Add a feature". The stack no longer prints "table … already exists, skipping create" for every projection table on each boot.
-->
