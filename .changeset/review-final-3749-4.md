---
"@cosmicdrift/kumiko-framework": patch
---

Documents the limit of the Meilisearch default-config upgrade: after a restart, an index whose stored settings are a strict subset of the current registry default is treated as an older default and widened again.

<!-- kumiko-changes
feature: framework
type: fix
title: Meilisearch default upgrade cannot tell a narrowed configure() from an older default
detail: A tenant that called configure() with a strict subset of the default attributes gets the full default back after the next process restart, because Meilisearch stores no marker for an explicit configure(). Configure the full attribute set, or a set that contains an attribute outside the default, to keep it.
-->
