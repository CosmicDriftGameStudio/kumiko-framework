---
"@cosmicdrift/kumiko-dev-server": patch
---

`kumiko-build` keeps `process.env.NODE_ENV` a runtime read in the server bundle.

<!-- kumiko-changes
feature: dev-server
type: bugfix
title: The production server bundle reads NODE_ENV at runtime
detail: Bun.build inlined the build host's NODE_ENV into `process.env.NODE_ENV`. The image build runs without it, so a deployed server took the development branch of every such check, for example the JSON-safety check in buildAppSchema. The bundle now reads the container's NODE_ENV.
-->
