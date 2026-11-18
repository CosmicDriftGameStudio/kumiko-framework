---
"@cosmicdrift/kumiko-guards": patch
---

`kumiko-guards security` ships the picomatch advisory exception GHSA-FC5Q-39XC-VJPF for every consumer.

<!-- kumiko-changes
feature: guards
type: fix
title: Bundled security exception for the picomatch advisory
detail: picomatch has no patched release and is only reached through glob tooling, so `kumiko-guards security` now carries the reviewed exception in its bundled `dependency-security-exceptions.json`. Apps no longer need their own copy to get a green security check.
-->
