---
"@cosmicdrift/kumiko-framework": patch
---

The client schema now carries the entity's `lockedWhen` condition. An entityEdit screen shows a record that matches it read-only even when the screen sets no `readOnly` of its own, as the `EditScreen.readOnly` docs already promised.

<!-- kumiko-changes
feature: framework
type: fix
title: Client schema carries entity lockedWhen
detail: buildAppSchema projects lockedWhen, so an entityEdit screen shows a locked record read-only without a screen-level readOnly.
-->
