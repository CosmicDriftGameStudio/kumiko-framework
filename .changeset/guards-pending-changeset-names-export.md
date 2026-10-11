---
"@cosmicdrift/kumiko-guards": patch
---

public-exports-changelog: an open breaking changeset only covers a dropped export when its title, detail or migration names that export, and the finding hint points to a changeset block plus `--write-baseline` instead of `kumiko changes add`.

<!-- kumiko-changes
feature: guards
type: fix
title: public-exports-changelog requires the open breaking changeset to name the dropped export
detail: Before, any open breaking kumiko-changes block of the owning feature let --write-baseline drop every export of that feature. Now the block's title, detail or migration must contain at least one dropped name, the same rule changes.json entries already follow. The finding hint and the report hint name the .changeset block and bun packages/guards/src/cli.ts public-exports-changelog --write-baseline. pendingBreakingFeaturesIn and loadPendingBreakingFeatures are renamed to pendingBreakingChangesIn and loadPendingBreakingChanges and return feature to block texts; featureFlagForCli is removed.
-->
