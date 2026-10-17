---
"@cosmicdrift/kumiko-dev-server": patch
---

Remove the kumiko-schema-check bin

<!-- kumiko-changes
feature: dev-server
type: breaking
title: The kumiko-schema-check bin and the resolveGeneratePath, usesDerivedSchemaLayout and implicitAuthModeFeatureNames exports are removed
detail: kumiko-schema-check diffed APP_FEATURES against a hand-kept FEATURE_IMPORT_REGISTRY. Apps with kumiko/schema.ts derive their entities from the mounted features and have no registry that could drift, so the check was a no-op there. The helpers resolveGeneratePath, usesDerivedSchemaLayout and implicitAuthModeFeatureNames are no longer exported from @cosmicdrift/kumiko-dev-server/cli.
migration: Apps with kumiko/schema.ts need nothing. Run kumiko-schema validate to check migrations against the mounted features, and remove kumiko-schema-check from package scripts and CI. Apps that keep a FEATURE_IMPORT_REGISTRY diff it against APP_FEATURES in their own coverage script.
-->
