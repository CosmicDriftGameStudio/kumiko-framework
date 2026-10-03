---
"@cosmicdrift/kumiko-bundled-features": patch
---

agent-tools: `list_<entity>` filters and `find_<entity>_by_<field>` tools only offer filterable fields that every caller role may read without a row condition. A role- or ownership-restricted filterable field can no longer be probed through `totalCount` or hit/miss results.

<!-- kumiko-changes
feature: agent-tools
type: security
title: agent entity tools no longer filter on read-restricted fields
migration: |
  No action needed: fields whose access.read is not unconditionally open to the agent's roles drop out of list filters and find-by tools.
-->
