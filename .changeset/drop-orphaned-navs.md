---
"@cosmicdrift/kumiko-renderer-web": patch
---

Navs whose parent does not exist in the app schema are dropped, transitively, instead of being promoted to the top level. A role-projected schema no longer shows an adopted child nav (e.g. AI providers for a TenantAdmin) when its parent section is system-admin only. Children whose parent exists but is filtered out by a workspace allowlist still surface at the top level.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: The sidebar drops navs whose parent is missing from the role-projected schema instead of promoting them to the top level
-->
