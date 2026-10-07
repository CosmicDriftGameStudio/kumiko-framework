---
"@cosmicdrift/kumiko-dev-server": patch
---

init-deploy rejects private GitHub packages without a registry config

An app with `@cosmicdriftgamestudio/*` dependencies but no `bunfig.toml`/`.npmrc` used to get a Dockerfile whose `bun install` failed with a 404 only inside the image build. `scaffoldDeploy`, `renderDeployFiles` and `checkDeployDrift` now throw with a hint to add the scope entry.

<!-- kumiko-changes
feature: dev-server
type: fix
title: init-deploy fails early when private GitHub packages have no bunfig.toml or .npmrc
-->
