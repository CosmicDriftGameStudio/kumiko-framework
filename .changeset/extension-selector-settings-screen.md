---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

A feature that declares `r.extensionSelector(extension, configKey)` now gets one tenant settings screen in the generated Settings-Hub: the selector as a select of the mounted plugin ids, and below it the config and secrets of the selected plugin. The panels follow the saved selection live.

New query `config:query:config-value:selected-extensions` returns the caller's selected plugin id per extension point.

BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and `config:write:set` rejects every other value except `""` with 422 `config.errors.unknownExtensionPlugin`. The owner's tenant screen `<owner>-tenant` is now a dashboard; its configEdit moved to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link still resolves), and their secrets move from the global `secrets` screen into `<plugin>-tenant-secrets` panels.

<!-- kumiko-changes
feature: config
type: breaking
title: Extension-selector settings render as one tenant screen
detail: |
  BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and
  `config:write:set` rejects every value except a mounted plugin id or "" with 422
  `config.errors.unknownExtensionPlugin`.

  The owner's tenant screen `<owner>-tenant` is now a dashboard; its former configEdit moved
  to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav
  entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link
  still resolves), and their secrets move from the global `secrets` screen into
  `<plugin>-tenant-secrets` panels. A plugin feature registered under more than one selector
  registration keeps the previous behaviour.

  Generated hub screens need the new key `config.settings.extensionSelectorHint` (shipped in
  the config and secrets bundles, en/de/es).
migration: |
  Links, tests or screenshots that open `<plugin>-tenant` through the nav or expect a configEdit
  at `<owner>-tenant` should open `<owner>-tenant` (now the dashboard) and look for the plugin
  panels there. Tenant rows or scripts that write a selector value naming no mounted plugin must
  write a mounted plugin id or "" instead. No new translation keys are required from apps.
-->
