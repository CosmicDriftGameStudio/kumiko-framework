---
"@cosmicdrift/kumiko-framework": patch
---

Feature-AST keeps referenced handler access/rateLimit headers

Handler headers (access, rateLimit, escapeHatch, agent on write/query/stream handlers, and escapeHatch on r.hook) authored as an imported or same-file const now round-trip verbatim through the feature AST instead of being silently dropped. `rateLimit: { disabled: true, reason }` is now extracted. streamHandler's escapeHatch is now extracted and rendered. A new ParseError: a fully literal header value with an unrecognized shape (used to silently drop the header instead). Handler calls whose object/options contain a spread, an unmodeled key (e.g. `outputSchema`, `perform`) or a non-literal options argument are now kept verbatim as an opaque pattern instead of losing those parts on render. `parsePatternChanges` accepts these reference and disabled-rate-limit shapes too.

<!-- kumiko-changes
feature: framework
type: fix
title: Feature-AST keeps referenced handler access/rateLimit headers
-->
