---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template-resolver collections, validate, diff, overview, seeding and bundle limits are tighter

<!-- kumiko-changes
feature: template-resolver
type: fix
title: collection kinds fail at boot; validate, diff-to-system, overview, seeding, bundle import and placeholder checks follow the write rules
detail: createTemplateResolverFeature throws for a collection whose kind is mail, mail-layout or pdf-layout instead of failing on every save. The validate query ignores scope system for non-SystemAdmins. diff-to-system compares only against an active system template like reset-to-system. The overview reads rows in a stable order and reports truncated when its row limit is hit. Re-seeding notification templates reactivates an archived system row and applies a changed parentTemplateId. A bundle holds at most 50 locales. Dotted placeholders under a declared variable or list item field are reported as unknown because they never render a value. The document editor fallbacks are read-only and the placeholder line editor recolors chips when systemVariables change.
-->
