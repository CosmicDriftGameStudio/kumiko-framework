---
"@cosmicdrift/kumiko-dev-server": minor
---

kumiko-dev-server no longer ships the kumiko-init-deploy and kumiko-upgrade bins.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: kumiko-dev-server drops the kumiko-init-deploy and kumiko-upgrade bins
detail: kumiko-init-deploy was deprecated because deploy/Dockerfile and deploy/Dockerfile.dockerignore are managed files. The bin, the export runInitDeployCli and the types CliOutput and RunInitDeployCliOptions are removed. kumiko-upgrade ships only with @cosmicdrift/kumiko-cli. renderDeployFiles, scaffoldDeploy and checkDeployDrift stay exported.
migration: Use `kumiko check managed` and `kumiko sync-managed --write` instead of kumiko-init-deploy. Calls of `kumiko-upgrade` keep working in every repo that depends on @cosmicdrift/kumiko-cli; add that dependency where only kumiko-dev-server is installed.
affects: kumiko-init-deploy, runInitDeployCli, RunInitDeployCliOptions, CliOutput, kumiko-upgrade
-->
