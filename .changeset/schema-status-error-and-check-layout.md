---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
---

kumiko-schema status reports connection errors; kumiko-schema-check knows the scaffold layout

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-schema status reports connection errors; kumiko-schema-check knows the scaffold layout
detail: schema status now prints a one-line error with a hint and exits 1 when the database is unreachable or missing, instead of an uncaught stacktrace (the URL is never printed). kumiko-schema-check exits 0 with a pointer to kumiko-schema validate for apps whose kumiko/schema.ts derives ENTITY_METAS from APP_FEATURES. New scaffolds create the app database in docker-compose.
-->
