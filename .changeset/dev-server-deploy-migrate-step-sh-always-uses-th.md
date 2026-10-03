---
"@cosmicdrift/kumiko-dev-server": minor
---

Deploy migrate-step.sh always uses the exact stack network

The discover variant (docker network ls | head -1) could pick another compose project's network on a shared host. The script now uses COMPOSE_PROJECT_NAME or the directory name plus _stack.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: Deploy migrate-step.sh always uses the exact stack network
migration: |
  Remove package.json kumiko.deploy.stackNetwork (or set it to "directory"), then re-run scaffoldDeploy. If the deploy directory name differs from the compose project, set COMPOSE_PROJECT_NAME for migrate-step.sh.
-->
