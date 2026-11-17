---
"@cosmicdrift/kumiko-feature-ast": minor
"@cosmicdrift/kumiko-cli": minor
---

Remove the upgrade codemods of releases up to 0.420.0; kumiko codemod lists import-extensions and feature-layout.

<!-- kumiko-changes
feature: cli
type: breaking
title: Upgrade codemods up to 0.420.0 removed
detail: Every app is past 0.420.0, so the upgrade codemods of earlier releases are gone from @cosmicdrift/kumiko-feature-ast (src/scripts/codemod), among them package-merge, feature-factory, s3-imports, migrate-db-raw, migrate-cross-tenant, migrate-open-to-all, object-form, db-factory, tenant-db-options, testing-move, testing-injection, ctx-namespaces, pii-personal-migration and scaffold-kms-mode. import-extensions and feature-layout, the two codemods a guard points to, stay next to the upgrade codemods of later releases, and `kumiko codemod` lists those two; feature-layout was missing from that list, so the hint of the app-feature-structure guard failed.
migration: An app whose .kumiko/upgrade-state.json is below 0.420.0 first runs `kumiko-upgrade --apply` with a framework release up to 0.420.0, then upgrades to this one.
-->
