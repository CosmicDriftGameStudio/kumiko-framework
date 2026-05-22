---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-framework": patch
---

Add deploy-template scaffolding (Sprint 9.6).

**New API:**

- `scaffoldDeploy({ appName, port?, githubOrg?, destination?, force? })` exported from `@cosmicdrift/kumiko-dev-server`. Generates `deploy/Dockerfile`, `deploy/Dockerfile.dockerignore`, and `deploy/migrate-step.sh` from canonical templates shipped with the package. Substitutes `{{appName}}`, `{{port}}`, `{{githubOrg}}` placeholders.
- New CLI command: `kumiko init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force]`.

The templates are extracted from publicstatus's production-tested `deploy/Dockerfile` (node-alpine build stage → bun-alpine runtime, drizzle migrations baked in, healthcheck wired). Refuses to overwrite existing files unless `--force` is passed so a tuned per-app Dockerfile isn't clobbered.

**Templates are a starting point, not a contract.** Apps should review and adjust:

- **Image tag** is hardcoded `:latest` in `migrate-step.sh.template`. Swap to `:${BUILD_SHA}` for atomic deploys.
- **DB defaults** in `migrate-step.sh.template` assume `db user = db name = appName`, host `db`, port `5432`. Adjust to your stack.
- **`COPY /app/seeds`** assumes the app uses ES-Operations seed migrations. Comment out if your app has no `seeds/` directory (otherwise `docker build` fails).
- **`docker build`-smoke-test:** the templates run untested against a non-publicstatus app-tree. Verify locally before pushing to CI.

**Deferred to Sprint 9.7+:** `.github/workflows/build-image.yml.suggested`, `pulumi/secrets-bootstrap.sh`, `pulumi/extraEnv.snippet.ts`.

**Plan-Doc drift (for 9.9 update):** Plan-Doc-Tabelle nennt `start.sh` (in-container migrate-then-run); diese Implementation liefert `migrate-step.sh` (host-side deploy-pipeline). Beide Konzepte sind gültig — Plan-Doc-Update sollte das klarstellen.
