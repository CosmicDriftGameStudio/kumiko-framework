---
"@cosmicdrift/kumiko-dev-server": patch
---

The `migrate-step.sh` that `kumiko-init-deploy` generates now reads `.env` before it picks the stack network. Before, a `COMPOSE_PROJECT_NAME` set only in `.env` was ignored and the script fell back to the directory name, so on a shared host it could run the migration against another app's network and Postgres. The project name, from `.env` or the directory, is lowercased and stripped to `[a-z0-9_-]` as Compose does, and the script still stops when the network does not exist. Regenerate the script in existing apps to pick this up.

<!-- kumiko-changes
feature: dev-server
type: fix
title: generated migrate-step.sh honours COMPOSE_PROJECT_NAME from .env
-->
