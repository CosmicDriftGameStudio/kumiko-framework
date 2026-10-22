---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-framework": patch
---

Guard and CI fixes: exception handling, timeout detection, renderer boundaries, import extensions and agent examples.

<!-- kumiko-changes
feature: guards
type: fix
title: Dependency exceptions, timeout and boundary guards no longer miss or invent findings
detail: A renewed license or security exception now wins over an expired earlier one, license exceptions must match the package license and a real semver range, and only exceptions that suppressed an advisory block on near expiry. The test-timeouts guard also flags union-typed and untyped timeout arguments, the renderer-boundaries guard covers headless and live imports, import-extensions ignores real .js files without a .ts sibling, and the generated agent examples now include bin, e2e, seeds and scripts files.
-->
