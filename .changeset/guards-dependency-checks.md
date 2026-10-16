---
"@cosmicdrift/kumiko-guards": minor
---

Add the licenses, security and outdated dependency checks to kumiko-guards

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-guards gains licenses, security and outdated subcommands
detail: bunx kumiko-guards licenses classifies installed packages against a licence allow/gray/deny policy, security runs bun audit (critical and high block, exceptions expiring within 14 days block), outdated fails on deprecated direct dependencies. All three scan the repo cwd sits in (installed packages from node_modules of the repo, its workspace members and every ancestor directory; the repo's bun.lock or the nearest ancestor's) and fail loudly when nothing is found. Each takes --report. They are not part of the default run or the checks bundle because they use the network. Exceptions need reason, reviewer and expiry; the package ships defaults and merges dependency-license-exceptions.json from the repo root and every ancestor whose node_modules was scanned, and dependency-security-exceptions.json from the repo root and the audited lockfile directory.
-->
