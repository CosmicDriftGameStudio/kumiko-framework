---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

DashboardTextPanel: blocks optional, text and items accept i18n objects

<!-- kumiko-changes
feature: renderer
type: breaking
title: DashboardTextPanel: blocks optional, text and items accept i18n objects
migration: |
  Consumers that read panel.blocks or block.text as plain strings: use blocks ?? [] and check typeof text === 'string' (DashboardText is string | i18n object).
-->
