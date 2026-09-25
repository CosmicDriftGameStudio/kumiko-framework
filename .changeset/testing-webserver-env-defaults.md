---
"@cosmicdrift/kumiko-testing": patch
---

`defineAppE2eConfig`'s webServer env now defaults the infra service vars, environment wins (fw#3118)

<!-- kumiko-changes
feature: testing
type: fix
title: defineAppE2eConfig's webServer env now defaults the infra service vars, environment wins
detail: |
  webServer.env is now built as `{ ...infraEnvDefaults(), ...PLAYWRIGHT_DEMO_ENV, ...env }`,
  where infraEnvDefaults() reads the same SERVICE_ENV_DEFAULTS the app's own
  preload uses (DATABASE_URL, REDIS_URL, MEILI_URL, MINIO_*, ...), falling
  back to each default only when process.env doesn't already carry a value.
  A CI/shell-set env var still wins over the template default. No
  `--env-file` is loaded here.
-->
