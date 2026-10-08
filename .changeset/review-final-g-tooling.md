---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Final review batch G: guards and tooling

The security guards (`direct-fetch`, `direct-entity-writes`, `tenant-escalation`, `unsafe-json-parse`, `html-escape`, `no-direct-fs`, `restricted-symbols`, `admin-api`, `access-denied-test`, `open-to-all-reason`, `escape-hatch-declared`) now scan a `tooling` root too. `direct-fetch` rejects a `guard-allow` marker without a specific reason. The `direct-entity-writes` canary also blocks when table declarations exist but write resolution finds nothing. `@cosmicdrift/kumiko-types` accepts the `postgres` prerelease alias in its peer range.
