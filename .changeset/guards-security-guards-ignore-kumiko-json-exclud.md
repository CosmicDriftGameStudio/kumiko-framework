---
"@cosmicdrift/kumiko-guards": minor
---

Security guards ignore kumiko.json excludes beyond node_modules and dist; kind framework is reserved for kumiko-framework

<!-- kumiko-changes
feature: guards
type: breaking
title: Security guards ignore kumiko.json excludes beyond node_modules and dist; kind framework is reserved for kumiko-framework
migration: |
  Security guards (No-Direct-Fs, Direct-Entity-Writes, Direct-Fetch, Tenant-Escalation, Admin-API, Access-Denied-Test, Open-To-All-Reason, Escape-Hatch-Declared) now scan files matched by your kumiko.json excludes; fix the findings or add a precise guard allowlist entry. A kumiko.json with kind framework outside the kumiko-framework package now fails root resolution; use library or app. Direct-Entity-Writes now sees table arguments behind casts (`table as T`, parentheses, non-null), so a cast no longer hides a direct write. i18n-Locale-Mount handles conditional spreads, alias depth and circular constants.
-->
