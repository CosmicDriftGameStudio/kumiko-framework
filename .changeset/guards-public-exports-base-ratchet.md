---
"@cosmicdrift/kumiko-guards": patch
---

public-exports-changelog: --base ratchets drops against the merge-base baseline, coverage matches whole identifiers

<!-- kumiko-changes
feature: guards
type: fix
title: public-exports-changelog --base=<ref> checks drops against the baseline of the merge-base and matches exported names as whole identifiers
detail: Check mode with --base=<ref> reads .kumiko-public-exports-baseline.json from the merge-base and sends every drop against it through the changelog/changeset ratchet, so a PR can no longer hide a removal by editing or deleting the baseline. An unknown ref is an error; a base without a baseline is a bootstrap. A changelog entry or open changeset covers a drop only when every dropped name appears in it as a whole identifier (getUserById no longer covers getUser). An unparsable changes.json is reported on stderr with its path. check-wt.sh, the worktree pre-push branch and the legacy check step pass the base.
-->
