---
"@cosmicdrift/kumiko-dev-server": minor
---

The managed ci.yml gains e2e shards and full Chromium, runs checks on pull requests only and builds without waiting for them.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: Managed ci.yml covers e2e shards and full Chromium, checks run on pull requests only
detail: package.json#kumiko.deploy takes `e2eShards` (integer from 1, default 1) and `e2eChromiumFull` (default false); they render `shards` and `chromium-full: true` into the e2e job. In the private ci.yml the test and integration jobs run on pull_request and merge_group only, like e2e, and the build on the main push no longer needs them, because the pull request already gated the merge. The public ci.yml caches the bun install and runs `bun kumiko-guards comment-lang` and `bun kumiko agent lint` in the test job.
migration: Delete the `# kumiko-managed: local …` line in .github/workflows/ci.yml, rename jobs only this app needs to `app-<name>`, move shards and full Chromium to kumiko.deploy.e2eShards and kumiko.deploy.e2eChromiumFull and MinIO or Meilisearch to ports.infra (s3, meilisearch) in kumiko.config.ts, then run `kumiko sync-managed --write`. A public app needs English comments or a comment-lang baseline and a description on every agent-visible handler.
-->
