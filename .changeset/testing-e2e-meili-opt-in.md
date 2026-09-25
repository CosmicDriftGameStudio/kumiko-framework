---
"@cosmicdrift/kumiko-testing": patch
---

`defineAppE2eConfig`'s webServer env no longer defaults `MEILI_URL`/`MEILI_MASTER_KEY`

<!-- kumiko-changes
feature: testing
type: fix
title: defineAppE2eConfig's webServer env no longer defaults MEILI_URL and MEILI_MASTER_KEY
detail: |
  Since the infra env defaults landed, every e2e webServer got
  MEILI_URL=http://localhost:17700. Apps that choose Meilisearch over
  their in-memory search adapter when MEILI_URL is set then pointed at an
  unreachable host in CI without a Meili service. Meili is opt-in again:
  the two vars reach the webServer only when the environment sets them or
  the app passes them via `env`. All other infra defaults are unchanged.
  Migration: an app whose e2e needs Meilisearch sets MEILI_URL (and
  MEILI_MASTER_KEY) in `defineAppE2eConfig({ env })` or in the CI env; an
  app that worked around it with `MEILI_URL: ""` can drop that override.
-->
