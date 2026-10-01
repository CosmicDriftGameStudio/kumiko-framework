---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Bundled screens use translated subtitles; PAT status and MFA strings are translated in de and es

<!-- kumiko-changes
feature: admin-shell
type: improvement
title: Bundled screen subtitles (admin-shell, jobs, auth-mfa, tier-engine, user-profile) are i18n keys with de and es translations
migration: |
  Additive. Apps that override these screen descriptions keep working; apps that asserted the old English description text in tests now see the translated subtitle.
-->
<!-- kumiko-changes
feature: personal-access-tokens
type: fix
title: The token list status column shows translated labels instead of raw status values
-->
