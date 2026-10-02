---
"@cosmicdrift/kumiko-framework": patch
---

The feature-AST patcher now replaces and unsets string-literal keys such as `"description": "old"` instead of appending a duplicate key or skipping the unset. `addStreamHandler` accepts `escapeHatch`. The defineEvent extractor accepts a shorthand `{ piiFields }` stance and reports a non-literal options argument with its own message.

<!-- kumiko-changes
feature: framework
type: fix
title: Feature-AST patcher handles quoted keys, stream-handler escapeHatch and shorthand piiFields
-->
