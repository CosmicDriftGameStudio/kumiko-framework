---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Follow-ups to the editor round: relative links in document anchors, a nav label for the create title, a pinned save bar, a render cache for managed pages and a single deletion card.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Document anchors accept relative links
detail: An anchor href in a document body may be relative (/path, ./, ../, #, ?); never // or a backslash. Other URL attributes (image src and similar) and mail links still accept only explicit schemes or placeholders. The sanitizer, the editor schema, compileDocumentBody and the confirmation mail use the same split.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Collection nav takes entryLabel for the create title
detail: A collection's nav takes an optional entryLabel (singular i18n key, new in the nav type and in the required surface keys of all locale packages). The create screen title reads "New {label}", or "New entry" without it.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: The editor panel keeps its save bar pinned
detail: A FormScreenLayout editor inside the editor panel gets the full panel height, so its save bar stays visible while the content scrolls.
-->

<!-- kumiko-changes
feature: managed-pages
type: improvement
title: The public render caches a sanitized document body per page version
detail: The render cache holds up to 500 entries keyed on tenant, slug, language, version and format. Bodies larger than 256 KB are sanitized on every render and not cached.
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: request-deletion-screen shows one deletion card
detail: The request form no longer draws its own card inside the screen's card, so the screen shows one deletion card.
-->
