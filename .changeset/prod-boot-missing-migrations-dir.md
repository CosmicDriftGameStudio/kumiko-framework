---
"@cosmicdrift/kumiko-framework": minor
---

Booting a production app or worker without a `kumiko/migrations` directory now aborts with a schema-drift error.

<!-- kumiko-changes
feature: framework
type: breaking
title: A missing migrations directory fails the prod boot
detail: `detectKumikoDrift` / `assertKumikoSchemaCurrent` treated a missing migrations directory as "no drift", so an image that lost `kumiko/migrations` booted against an unmigrated database. It is now drift: the report has `migrationsDirMissing: true`, `ok: false`, and `runProdApp` / the worker boot abort with a `SchemaDriftError`.
migration: Ship `kumiko/migrations/` in the image or point `migrations.dir` at it. Apps that manage their schema without Kumiko migrations pass `migrations: false`.
affects: all
-->
