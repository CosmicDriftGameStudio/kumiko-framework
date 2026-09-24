---
"@cosmicdrift/kumiko-framework": patch
---

Idle event-dispatcher passes no longer take a `FOR UPDATE SKIP LOCKED` row lock (and thus no WAL record) on every consumer's state row every poll tick.

<!-- kumiko-changes
feature: framework
type: fix
title: Idle event-dispatcher passes no longer lock consumer rows or write WAL
-->
