---
"@cosmicdrift/kumiko-bundled-features": patch
---

tags and notes-history: `ownership.write` is now enforced by `assign-tag`, `remove-tag` and `add-note`. Each feature instance builds its write executor from the entity it registers; before, the handlers used a module-level executor without the mount's ownership, so a `from()` write rule never applied to them. The `delete-tag` cascade stays ungated.

<!-- kumiko-changes
feature: tags
type: breaking
title: ownership.write applies to assign-tag, remove-tag and add-note
migration: |
  Mounts that set `ownership.write` now see ownership_denied for callers the rule does not cover. Make sure the rule covers every role that tags or notes, or leave it unset.
-->
