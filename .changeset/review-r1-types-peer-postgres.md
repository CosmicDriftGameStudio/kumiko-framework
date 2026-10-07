---
"@cosmicdrift/kumiko-types": patch
---

The `postgres` peer dependency is `^3.4.9` again instead of the fork alias

Consumers that install upstream `postgres` no longer get a peer warning; the fork alias stays only in the dev dependency.

<!-- kumiko-changes
feature: types
type: fix
title: postgres peer dependency accepts upstream ^3.4.9 instead of requiring the fork alias
-->
