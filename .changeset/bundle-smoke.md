---
"@cosmicdrift/kumiko-dev-server": patch
---

`buildServerBundle` BUILD_ONLY_EXTERNALS erweitert um drizzle-kit's
dialect-resolver dynamic-imports: `@planetscale/database`, `@libsql/client`,
`better-sqlite3`, `@neondatabase/serverless`, `@vercel/postgres`, `mysql2`.

Aufgedeckt durch C1 Empfehlung 4 (bundle-smoke). Bisher schlug
`bun build` an dynamic-imports im drizzle-kit auch wenn der App nur
postgres nutzt. Externalisieren = build durchläuft + tree-shake wirft
die ungenutzten driver-modules eh raus.
