---
"@cosmicdrift/kumiko-bundled-features": minor
---

Token screens follow the tier gate of personal-access-tokens

The list and mint screens carry a `visibleWhen` on the new `personal-access-tokens:query:availability` probe. For a tenant whose tier excludes the feature (`toggleable`), the dispatcher already rejected every token handler with `feature_disabled`; now the screens also show the unavailable notice instead of an empty list with a broken Create button. A new option `lockedFallbackScreen` names a screen (for example an upgrade notice) to show in its place. Without `toggleable` nothing changes: the feature stays always on.

<!-- kumiko-changes
feature: personal-access-tokens
type: feature
title: API-token screens hide behind the tier gate and can fall back to an upgrade screen via lockedFallbackScreen
-->
