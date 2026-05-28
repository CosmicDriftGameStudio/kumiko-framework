---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
---

Fix deploy-template drift after the drizzle→`kumiko schema` cutover. Three stale references in the scaffolded `Dockerfile` + `migrate-step.sh` broke every fresh deploy and would have re-broken existing deploys on the next re-scaffold:

- `Dockerfile.template` copied `/app/dist-server/drizzle.config.ts`, which the single-bundle server build (0.20.0) no longer emits — Docker `COPY` of a missing source fails hard.
- `Dockerfile.template` copied `/app/drizzle`, but apps on the new schema pipeline (0.21.0) ship `kumiko/migrations/` instead. The COPY broke for apps without a legacy `drizzle/` directory, and even when it succeeded the SQL the runtime needs (`${INIT_CWD}/kumiko/migrations/*.sql`) was missing. Replaced with `COPY /app/kumiko/migrations ./kumiko/migrations`.
- `Dockerfile.template` set `ENV KUMIKO_MIGRATION_HOOKS=/app/migration-hooks.js`, pointing at a bundle output that 0.20.0 also dropped. The new `schema apply` path doesn't read this env — removed.
- `migrate-step.sh.template` invoked `bun /app/kumiko.js migrate apply`, but the CLI registers no `migrate` command — only `schema apply`. The pre-deploy migrate step crashed with `Unknown command: migrate`. Fixed to `bun /app/kumiko.js schema apply`.

Header comments + `KUMIKO_REPO_ROOT`/`INIT_CWD` annotations rewritten to describe the schema-CLI path instead of drizzle-kit. Two new regression tests in `scaffold-deploy.test.ts` lock the migrate command + pin the kumiko/migrations COPY so this drift can't silently return.

This corrects the "no deploy change" claim in the 0.20.0 changelog entry: 0.20.0 was a deploy-template change, the templates just hadn't been updated.
