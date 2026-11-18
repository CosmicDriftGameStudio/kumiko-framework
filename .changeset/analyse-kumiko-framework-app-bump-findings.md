---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The managed `bin/kumiko.ts` reads `process.env["INIT_CWD"]` with bracket access, so it type-checks in apps with `noPropertyAccessFromIndexSignature`. `billing-foundation:write:start-plan-checkout` and `billing-foundation:write:switch-plan` ship their title and field labels (en, de, es, fr, it), so `kumiko agent lint` no longer reports them as handler translation gaps in an app that mounts a plan catalog.
