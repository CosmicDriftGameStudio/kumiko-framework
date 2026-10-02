---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Generated config screens (configEdit, secretsEdit, extension-selector dashboard) render as a settings list: section header on top, one row per key with label, description, origin and reset on the left and the control on the right, hairlines between rows and an accent line on values set at the current level. `EditLayout.variant: "settings-list"` enables the layout, `RenderEditProps.dirtyFooter` shows the unsaved count with Discard and Save changes, `validateOnChange` shows field errors while typing. Number bounds on config keys are validated on the client and read "Must be 1000 or less" / "Must be at least 1". Rows split into two columns by container width, so they stack next to a sidebar on tablets.

`DashboardScreenDefinition.showUpdatedAt` (default true) hides the "As of" timestamp; the selector dashboard sets it to false. `DashboardScreenPanel.chromeless` embeds a panel's screen without card frame and without its own screen padding, aligned to the page grid; the selector dashboard uses it. Features can name the config section via `<feature>.settings.section`; tenant-settings uses it and the platform screen is titled "Tenant defaults" to match the navigation.

Consumer tests on secretsEdit need updating: the `required-marker-<field>` test id is gone (a missing required secret now shows as the `secret-not-set-<field>` status), a stored secret gets `secret-saved-<field>`, and `secrets-edit-submit` stays disabled until at least one secret is entered.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Settings list layout for generated config and secrets screens
-->
