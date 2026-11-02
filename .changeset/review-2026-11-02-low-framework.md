---
"@cosmicdrift/kumiko-framework": patch
---

The schema validate output and the drift report name the same `bun kumiko-schema` commands, and comments on the production path name `bun /app/kumiko.js schema apply`.

<!-- kumiko-changes
feature: framework
type: fix
title: consistent schema command names in validate output
detail: `kumiko-schema validate` suggests `bun kumiko-schema generate <name>` like the drift report does; internal comments on the production path name `bun /app/kumiko.js schema apply`.
-->
