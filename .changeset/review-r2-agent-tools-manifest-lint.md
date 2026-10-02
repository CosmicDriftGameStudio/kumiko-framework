---
"@cosmicdrift/kumiko-bundled-features": patch
---

Agent tools: `buildAgentManifest` now throws when `denyQns` names a handler that is not registered, so a typo can no longer leave a handler exposed. Navs whose parent is hidden from the role are dropped from the manifest, and screens reachable only through them are no longer listed. The agent doc lint reports handlers that are exposed without a description and treats a blank description as a gap.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Manifest rejects unknown denyQns, drops navs under hidden parents; doc lint flags blank and exposed-undescribed handlers
migration: |
  `buildAgentManifest` now throws when `denyQns` names a handler that is not registered; remove stale or misspelled entries from your `denyQns` lists.
-->
