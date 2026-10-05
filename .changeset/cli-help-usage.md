---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-cli": patch
"create-kumiko-app": patch
---

`--help` prints usage on every bin

`kumiko-init-deploy --help` used to write the deploy files, and `kumiko-testing integration --help` crashed while parsing its arguments. Both now print their usage and exit 0, as do `kumiko-build`, `kumiko-dev`, `kumiko-schema-check` and `create-kumiko-app`.

<!-- kumiko-changes
feature: dev-server
type: fix
title: --help prints usage instead of running the command (init-deploy, build, dev, schema-check, kumiko-testing integration)
-->
