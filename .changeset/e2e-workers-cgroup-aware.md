---
"@cosmicdrift/kumiko-testing": patch
---

`defineAppE2eConfig` derived its default worker count from `os.cpus()`, which reports the host's cores inside a CPU-limited container. CI runner pods capped at 1.5 CPU therefore started 4 Playwright workers, so heavier apps hit the 30s test timeout. The default now uses `os.availableParallelism()`, which honours the cgroup CPU quota.

<!-- kumiko-changes
feature: testing
type: fix
title: E2E worker default respects the container CPU limit
-->
