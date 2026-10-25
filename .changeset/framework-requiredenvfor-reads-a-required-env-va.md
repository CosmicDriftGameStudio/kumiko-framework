---
"@cosmicdrift/kumiko-framework": minor
---

requiredEnvFor reads a required env var in ops scripts

@cosmicdrift/kumiko-framework/env exports requiredEnvFor(label, env). It returns a reader that hands back the value of a set variable and throws "[label] required env var NAME is missing or empty" otherwise; an empty string counts as missing and the error never contains a value. The env source is passed in, so a script can read from the KEK-resolved env of resolvePlatformKeks as well as from process.env. It replaces the requiredEnv copies in app bin/ops scripts.

<!-- kumiko-changes
feature: framework
type: improvement
title: requiredEnvFor reads a required env var in ops scripts
-->
