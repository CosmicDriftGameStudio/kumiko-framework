---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-guards": patch
---

`kumiko-upgrade` and the changelog guards handle canary versions such as `0.425.0-next-20261118143000-abc1234` from the new `next` dist-tag.

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade accepts canary versions from the next dist-tag
detail: Versions now compare by semver precedence, so a canary sorts above the previous release, below the release it previews and after older canaries of the same release. `kumiko-upgrade` accepts a canary as `--from`, as installed version and in `.kumiko/upgrade-state.json`, and keeps the full canary version in the marker instead of claiming the release. A canary installs the changelog entries of the release it previews. After `--apply` on a canary, the codemods and manual steps the marker recorded are not pending again; one that a later canary of the same release adds shows up as pending.
-->

<!-- kumiko-changes
feature: guards
type: fix
title: Public-exports changelog guard orders prerelease versions by semver
detail: `compareVersionsLocal` used to ignore a prerelease suffix, so `1.0.0-rc.1` counted as `1.0.0`. It now uses semver precedence, the same order `kumiko-upgrade` uses.
-->
