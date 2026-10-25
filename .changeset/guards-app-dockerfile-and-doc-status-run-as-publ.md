---
"@cosmicdrift/kumiko-guards": minor
---

app-dockerfile and doc-status run as public repo checks

kumiko-guards checks now includes app-dockerfile and doc-status, ported from the private infra guards package. app-dockerfile inspects deploy/Dockerfile: public/index.html or index.html must exist; with @cosmicdriftgamestudio/* dependencies the build stage copies a bunfig.toml or .npmrc scope entry before bun install and that RUN mounts the npm_auth_token BuildKit secret under the variable the registry config reads. The token as ARG/ENV (NPM_AUTH_TOKEN or the variable the registry config reads) is a warning for now and a violation next to a secret mount. Apps without private dependencies no longer need registry auth in the Dockerfile. doc-status requires valid status frontmatter for docs under docs/plans, runbooks, migration and reference; missing issue refs, finished plans outside the archive and malformed depends refs are warnings.

<!-- kumiko-changes
feature: guards
type: improvement
title: app-dockerfile and doc-status run as public repo checks
-->
