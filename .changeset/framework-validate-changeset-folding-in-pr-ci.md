---
"@cosmicdrift/kumiko-framework": patch
---

Validate changeset folding in PR CI

The release-time `changes fold` now also runs as a dry run on every PR, so a changeset with an unresolvable feature fails its own PR instead of the next release.

<!-- kumiko-changes
feature: framework
type: fix
title: Validate changeset folding in PR CI
-->
