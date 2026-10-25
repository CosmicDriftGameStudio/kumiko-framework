---
"@cosmicdrift/kumiko-dev-server": minor
---

The managed Dockerfile reads the registry token from a BuildKit secret

<!-- kumiko-changes
feature: dev-server
type: breaking
title: The managed Dockerfile reads the registry token from a BuildKit secret
migration: |
  Image builds pass the token as a BuildKit secret instead of a build-arg: docker build --secret id=npm_auth_token,env=NPM_AUTH_TOKEN, or secrets: npm_auth_token=... in docker/build-push-action. The infra _docker-build-push workflow already sends both. Run kumiko-upgrade --apply to rewrite deploy/Dockerfile; a Dockerfile with a kumiko-managed: local override changes by hand: drop ARG NPM_AUTH_TOKEN and ENV GITHUB_TOKEN and start the build-stage install with RUN --mount=type=secret,id=npm_auth_token,env=GITHUB_TOKEN bun install.
-->
