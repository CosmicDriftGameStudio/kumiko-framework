# @cosmicdrift/kumiko-samples

## 0.395.0

No changes in this release.

## 0.394.0

No changes in this release.

## 0.393.0

No changes in this release.

## 0.392.2

No changes in this release.

## 0.392.1

No changes in this release.

## 0.392.0

No changes in this release.

## 0.391.1

No changes in this release.

## 0.391.0

No changes in this release.

## 0.390.1

No changes in this release.

## 0.390.0

### Patch Changes

- 54cda5b: Integration tests seed event-sourced rows through the event store and reset event-sourced tables together with the events table.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Tests seed and reset event-sourced tables through the event store
  detail: Seeds of user, membership, tenant and other entity rows use seedRowViaEventStore instead of seedRow, so their created events exist. Setup and teardown hooks in the integration tests clear event-sourced tables through resetTestTables instead of raw DELETE statements, and clear the events table in the same call, so a test no longer starts with events whose projection rows are gone. Nothing changes for apps; the packages are only republished.
  -->

## 0.389.0

No changes in this release.

## 0.388.0

No changes in this release.

## 0.387.0

No changes in this release.

## 0.386.0

No changes in this release.

## 0.385.0

No changes in this release.

## 0.384.0

No changes in this release.

## 0.383.1

No changes in this release.

## 0.383.0

No changes in this release.

## 0.382.0

No changes in this release.

## 0.381.0

No changes in this release.

## 0.380.0

No changes in this release.

## 0.379.0

### Patch Changes

- ece210b: Samples pass the registry to createTemplateResolverApi.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Samples follow the createTemplateResolverApi(db, registry) signature
  detail: Recipes and sample apps build the template resolver API with the registry as second argument.
  -->

## 0.378.0

No changes in this release.

## 0.377.0

No changes in this release.

## 0.376.0

No changes in this release.

## 0.375.0

No changes in this release.

## 0.374.0

No changes in this release.

## 0.373.0

No changes in this release.

## 0.372.0

No changes in this release.

## 0.371.1

No changes in this release.

## 0.371.0

No changes in this release.

## 0.370.0

No changes in this release.

## 0.369.0

No changes in this release.

## 0.368.0

No changes in this release.

## 0.367.0

No changes in this release.

## 0.366.0

No changes in this release.

## 0.365.1

No changes in this release.

## 0.365.0

### Patch Changes

- b6b75fa: pdf-audit-export rejects oversized periods; sample docs and licence fixes
  
  <!-- kumiko-changes
  feature: samples
  type: fix
  title: pdf-audit-export rejects oversized periods; sample docs and licence fixes
  detail: The audit export fails with 422 audit_period_too_large above 100 rows instead of silently truncating. The samples LICENSE names the right Licensed Work.
  -->

## 0.364.0

No changes in this release.

## 0.363.0

## 0.362.0

## 0.361.0

## 0.360.0

## 0.359.0

## 0.358.0

## 0.357.0

## 0.356.0

## 0.355.0

## 0.354.1

## 0.354.0

## 0.353.0

## 0.352.0

## 0.351.0

## 0.350.0

## 0.349.0

## 0.348.1

## 0.348.0

## 0.347.0

## 0.346.0

## 0.345.0

## 0.344.0

## 0.343.0

## 0.342.0

## 0.341.0

## 0.340.0

## 0.339.0

### Patch Changes

- 2ae49bc: The workspace link of `@cosmicdrift/kumiko-samples` now shows the published layout. `packages/samples/{samples,packages}` hold checked-in relative symlinks to the repo sources, so a consumer that resolves `@cosmicdrift/kumiko-samples/package.json` in a workspace finds `samples/recipes`, `samples/apps` and `packages/bundled-features` next to it. `prepack` swaps the symlinks for the filtered real copies and `postpack` restores them. The published tarball is unchanged.

  <!-- kumiko-changes
  feature: samples
  type: improvement
  title: Workspace link of kumiko-samples shows the published layout through checked-in symlinks
  detail: |
    `scripts/stage-samples-package.ts` declares the shipped layout once. `stage` replaces the symlinks with filtered copies for packing, `clean` removes the copies and restores the symlinks. `verify-samples-package.sh` now expects the symlinks, not an empty folder, after packing.
  -->

## 0.338.0

### Minor Changes

- b036209: New package with the sample recipes, sample apps and bundled-features sources

  `@cosmicdrift/kumiko-samples` ships the sample recipes, sample apps and bundled-features sources in the repository layout. Tools such as the few-shot corpus build can run against a pinned version of it and get the same entry ids and source paths as in the monorepo.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: New package @cosmicdrift/kumiko-samples with the corpus sources
  -->
