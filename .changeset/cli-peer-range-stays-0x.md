---
"@cosmicdrift/kumiko-cli": patch
---

kumiko-cli declares its optional peers framework and bundled-features with an explicit 0.x range, and changesets only bumps peer dependents when that range is left, so a minor framework release no longer pushes the fixed package group to 1.0.0

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko-cli optional peers no longer force a 1.0.0 release
-->
