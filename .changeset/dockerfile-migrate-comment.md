---
"@cosmicdrift/kumiko-dev-server": patch
---

The managed Dockerfile names the migrate-db initContainer of the infra app deployment as the migration step.

<!-- kumiko-changes
feature: dev-server
type: fix
title: The managed Dockerfile names the real k3s migration step
detail: The comment above the migrations COPY in the managed Dockerfile pointed at a release.yml InitContainer that does not exist. It now names the migrate-db initContainer of the infra _app-deploy.yml, and migrate-step.sh for compose hosts. Only the comment changes; the next kumiko-upgrade shows it as a managed-file diff.
-->
