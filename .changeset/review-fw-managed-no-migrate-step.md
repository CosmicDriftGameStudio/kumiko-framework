---
"@cosmicdrift/kumiko-dev-server": minor
---

`deploy/migrate-step.sh` is no longer a managed file: `kumiko new app` does not write it and `kumiko check managed` / `sync-managed` ignore it, because managed apps migrate through the InitContainer of the k3s `release.yml`. Apps may delete an existing `deploy/migrate-step.sh`, sync no longer maintains it. `scaffoldDeploy` and `kumiko-init-deploy` still produce it for compose self-hosting.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: migrate-step.sh leaves the managed file set
detail: Managed apps run migrations as the k3s InitContainer from release.yml, so deploy/migrate-step.sh is neither scaffolded nor synced for them. Delete it if present. kumiko-init-deploy keeps generating it for compose self-hosting.
-->
