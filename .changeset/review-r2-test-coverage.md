---
"@cosmicdrift/kumiko-guards": patch
---

The guards `--explain` run now honors the injectable project builder, so its no-slot behavior is covered by a fast unit test.

<!-- kumiko-changes
feature: guards
type: fix
title: Guards --explain uses the injectable project builder
detail: runGuardsCli builds the explain project through the same buildProject dependency as the check run, which lets tests assert that --explain takes no guard run slot without parsing the whole repository.
-->
