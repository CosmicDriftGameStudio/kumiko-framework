---
"@cosmicdrift/kumiko-framework": patch
---

Feature-AST keeps referenced handler access/rateLimit headers

Handler headers (access, rateLimit, escapeHatch, agent on write/query/stream handlers, and escapeHatch on r.hook) authored as an imported or same-file const now round-trip verbatim through the feature AST instead of being silently dropped. `rateLimit: { disabled: true, reason }` is now extracted. streamHandler's escapeHatch is now extracted and rendered. Two new ParseErrors: a positional options argument that is not an inline object literal, and a fully literal header value with an unrecognized shape (both used to silently drop the header instead). `parsePatternChanges` accepts these reference and disabled-rate-limit shapes too.

<!-- kumiko-changes
feature: framework
type: fix
title: Feature-AST keeps referenced handler access/rateLimit headers
-->
