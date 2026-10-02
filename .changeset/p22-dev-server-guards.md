---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
---

The dev server serves `public/` files from the symlink-resolved path (realpath check before the read) and works when `public/` itself is a symlink. Ephemeral dev boots delete their per-boot BullMQ keys from the shared Redis on `stop()`. `kumiko-init-deploy --out <dir>` defaults the app name from that directory's `package.json`. The generated `migrate-step.sh` with `stackNetwork: "directory"` derives the network name like Docker Compose (lowercased, sanitised, `COMPOSE_PROJECT_NAME` wins). `setupTestStackFromFeatures` with the `config` preset throws a clear error when `extraContext.configResolver` is not a resolver. The runtime-isolation guard reports each regression at its own import line, and the upgrade-state guard no longer hangs on a stuck `kumiko-upgrade` (stdin ignored, timeout).

<!-- kumiko-changes
feature: dev-server
type: fix
title: public/ served via realpath incl. symlinked public/, ephemeral dev queues cleaned on stop, init-deploy --out app name, compose-style migrate-step network name, config preset validates configResolver; guards report correct isolation lines and time out kumiko-upgrade
-->
