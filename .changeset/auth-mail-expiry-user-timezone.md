---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Auth mails state the link validity as a duration and in the user's time zone

The five token mail renderers replace the UTC timestamp with `{duration}` (for example "1 day") and `{when}` (medium date and short time with zone abbreviation, in the recipient's locale). `RenderTokenContentArgs` gains `issuedAt` (default now) and `timeZone` (default UTC; an invalid zone falls back to UTC); the handlers pass the token issue time and `ctx.tz.user`. German strings use "Konto" instead of "Account".

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Mail expiry shows duration and local time with time zone
migration: |
  Custom `auth.mail.*.expiry` translations should use the new `{duration}` and `{when}` placeholders; `{when}` now includes the time and zone abbreviation instead of a UTC timestamp.
-->
