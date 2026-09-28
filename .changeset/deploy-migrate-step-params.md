---
"@cosmicdrift/kumiko-dev-server": minor
---

migrate-step.sh now reads `package.json#kumiko.deploy` (`dbUser`, `stackNetwork: "discover" | "directory"`); defaults are unchanged (dbUser = appName, stackNetwork = "discover"), and invalid values fail the render/check loudly instead of silently falling back.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: migrate-step.sh reads package.json#kumiko.deploy (dbUser, stackNetwork "discover" | "directory"); defaults unchanged, invalid values fail the render and the drift check
migration: |
  No action needed: without `kumiko.deploy` the scaffolded
  `deploy/migrate-step.sh` renders byte-identical to before. Apps whose
  database user is not the app name set
  `"kumiko": { "deploy": { "dbUser": "<user>" } }`; apps that want the
  exact `<dirname>_stack` network instead of the `docker network ls`
  heuristic set `"stackNetwork": "directory"`. Both `kumiko-init-deploy
  --force` and `--check` read the same config, so the drift check needs
  no extra flags. `ScaffoldDeployDetected` gained `dbUser` and
  `stackNetwork`.
-->
