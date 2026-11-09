---
"@cosmicdrift/kumiko-dev-server": patch
---

The deploy Dockerfile builds for arm64 and amd64.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Deploy Dockerfile runs bun on the build platform
detail: The managed `deploy/Dockerfile` runs every bun step in a `--platform=$BUILDPLATFORM` stage. A new `deps` stage installs the server bundle's production dependencies with `--os=linux --cpu=<x64|arm64>` for the target, and the runtime stage only copies them. An amd64 image built on arm64 runners therefore never runs bun under QEMU, where it aborts. The managed public CI workflow builds `linux/arm64,linux/amd64`. Apps pick it up with `kumiko sync-managed --write`.
-->
