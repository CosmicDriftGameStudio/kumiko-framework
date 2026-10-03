---
"@cosmicdrift/kumiko-samples": patch
---

The workspace link of `@cosmicdrift/kumiko-samples` now shows the published layout. `packages/samples/{samples,packages}` hold checked-in relative symlinks to the repo sources, so a consumer that resolves `@cosmicdrift/kumiko-samples/package.json` in a workspace finds `samples/recipes`, `samples/apps` and `packages/bundled-features` next to it. `prepack` swaps the symlinks for the filtered real copies and `postpack` restores them. The published tarball is unchanged.

<!-- kumiko-changes
feature: samples
type: improvement
title: Workspace link of kumiko-samples shows the published layout through checked-in symlinks
detail: |
  `scripts/stage-samples-package.ts` declares the shipped layout once. `stage` replaces the symlinks with filtered copies for packing, `clean` removes the copies and restores the symlinks. `verify-samples-package.sh` now expects the symlinks, not an empty folder, after packing.
-->
