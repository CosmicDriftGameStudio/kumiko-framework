---
"@cosmicdrift/kumiko-renderer-web": patch
---

filterAppSchemaNavsByAllowlist keeps allowed children of a filtered-out parent at the top level

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Allowed navs whose parent is not on the sidebar allowlist surface at the top level again
detail: filterAppSchemaNavsByAllowlist removes the parent reference of an allowed nav whose parent exists but is not allowlisted, unless a reparent override moves it. Before, such a nav and all its descendants vanished from the sidebar without a warning, contradicting the documented top-level behaviour.
-->
