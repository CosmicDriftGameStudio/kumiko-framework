---
"@cosmicdrift/kumiko-dev-server": minor
---

Added a dedicated `@cosmicdrift/kumiko-dev-server/env-schema` subpath export for `frameworkCoreEnvSchema`, so app repos' `bin/env.ts` (which every app's prod boot path reads) no longer has to pull in the full `runDevApp`/`scaffoldApp`/tooling barrel just for the schema.

Also marked `compose-stacks.ts` with a `// @runtime runtime` directive: despite living in this `"dev"`-marked package, every preset it exports composes `@cosmicdrift/kumiko-bundled-features` factories and is consumed by `run-config.ts`'s `runProdApp` boot path in 5 app repos today — the directive is the runtime-isolation guard's highest-priority classification layer and lets this one file opt out of the package-wide `"dev"` marker without reclassifying the whole package (which would also mislabel genuinely dev-only exports like `runDevApp`/`scaffoldApp`). No behavior change; this only affects the infra runtime-isolation guard's classification of the file.
