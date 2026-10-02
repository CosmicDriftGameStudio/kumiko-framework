---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko project` and `kumiko consumer` now reject an unknown or missing subcommand with the usage text before importing the config or touching the database. A failing state-table DDL no longer leaks the connection pool and is reported as an error with exit code 1.

<!-- kumiko-changes
feature: cli
type: fix
title: project and consumer validate the subcommand before any database work
-->
