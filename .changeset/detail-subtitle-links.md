---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

projectionDetail header subtitle with several parts and links

`header.subtitle` accepts a list of parts (field name or `{ field, navigate }`). Empty parts drop out, the rest are joined by a "·" separator, and a part with `navigate` links to the referenced record (entity or screen target, only when reachable). The Link primitive gets an optional `onPress` for SPA navigation, Text an optional `decorative` flag. `subtitleHref` stays valid with the string form only; the boot validator rejects the combination with a list.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail header subtitle can show several parts, each optionally linking to the referenced record
migration: No code change needed.
-->
