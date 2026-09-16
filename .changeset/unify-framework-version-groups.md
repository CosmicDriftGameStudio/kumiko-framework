---
"@cosmicdrift/kumiko-framework": minor
---

Merge the CLI, scaffolder, guards, and repo-manifest version lines into the
existing framework fixed group, so the version number alone shows what
belongs together. `@cosmicdrift/kumiko-cli`, `create-kumiko-app`,
`@cosmicdrift/kumiko-guards`, and `@cosmicdrift/kumiko-repo-manifest` jump
once to the group version at the next release, then move in lockstep with
the other 11 packages from then on.

<!-- kumiko-changes
feature: framework
type: improvement
title: Unify all framework packages into one version group
detail: kumiko-cli, create-kumiko-app, kumiko-guards, and kumiko-repo-manifest join the existing fixed version group; all 15 non-private packages now share one version number.
-->
