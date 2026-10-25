---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Closes four gaps in plain framework screens. The projectionDetail header badge shows the translated status, the shell title follows the active workspace, cap-overview formats amounts by unit and says "Not included" for a limit of 0, and admin-shell can drop its tenant overview.

<!-- kumiko-changes
feature: types
type: improvement
title: RecordHeaderSpec takes statusFormat
detail: header.statusFormat is a FormatSpec for the header badge text, typically enumOption with a keyPrefix. The badge tone still resolves on the raw status value.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: The projectionDetail header badge shows the translated status
detail: The header badge formats its text with header.statusFormat. Without it, the badge reuses the layout renderer of the status field when that is enumOption or i18nText, so header and body show the same text. Without either, the raw value is shown as before. The tone keeps resolving on the raw value.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: The shell header title follows the active workspace
detail: When two navs point at the same screen, the breadcrumb now takes the label of the nav the sidebar shows for the active workspace. Before, the first nav in the app won, so the title could differ from the sidebar entry. Without a matching nav in the workspace, the old lookup applies.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The boot validator checks header.statusFormat
detail: A projectionDetail screen with header.statusFormat but without header.status fails boot, because there is no badge to format.
-->

<!-- kumiko-changes
feature: cap-overview
type: improvement
title: Cap amounts follow their unit and a limit of 0 reads "Not included"
detail: Values with unit "mb" show as MB, GB or TB (base 1024), count and tokens use the locale's digit grouping. A limit of 0 or less shows "Not included" instead of a 0 bar, also when nothing is measured. caps:usage rows and the tenant-caps list cells now carry the unit of the cap. New key cap-overview.notIncluded in all locale packages.
-->

<!-- kumiko-changes
feature: admin-shell
type: improvement
title: includeTenantOverview turns the tenant overview off
detail: createAdminShellFeature({ includeTenantOverview: false }) registers neither the tenant overview screen nor its nav and leaves it out of the tenant workspace. The default stays true.
-->
