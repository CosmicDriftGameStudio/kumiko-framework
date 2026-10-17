---
"@cosmicdrift/kumiko-framework": patch
---

Feature de-duplication compares the full registered surface

<!-- kumiko-changes
feature: framework
type: fix
title: Same-named features that differ in screens, navs, jobs, events or hooks no longer merge silently
detail: dedupeFeatures now compares the keys of screens, navs, jobs, events, translations, config keys, notifications, metrics and hooks in addition to entities and handlers, so a second same-named feature with different surface throws instead of being dropped.
-->
