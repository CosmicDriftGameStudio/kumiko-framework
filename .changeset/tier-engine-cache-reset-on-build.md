---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tier resolver no longer keeps tier writes made before its build.

<!-- kumiko-changes
feature: tier-engine
type: fix
title: The tier resolver no longer keeps tier writes made before its build
detail: A tier write that ran before build() cached a feature set without the always-on features, and a later build() left that entry in place, so the tenant got feature_disabled instead of the default fallback. build() now starts from an empty cache and writes before it are not cached.
-->
