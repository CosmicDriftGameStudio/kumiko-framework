---
"@cosmicdrift/kumiko-bundled-features": minor
---

Login, password reset and user creation treat an email address the same regardless of upper or lower case.

<!-- kumiko-changes
feature: user
type: breaking
title: User email lookups and writes are case-insensitive
detail: `user:find-for-auth`, `user:create` and `user:update` lowercase the email in their schema, `seedUser` and the signup guard lowercase it before lookup and insert, and `login` lowercases before the lookup and the unknown-email lockout count. Before, the blind index compared byte-exact, so `Max@Firma.de` failed to log in to `max@firma.de` and `user:create` could add a second account for the same address in other casing. Emails returned by these handlers are now always lowercase.
migration: Stored emails that contain upper case letters are no longer found; lowercase them before upgrading. Callers that compared a returned email against mixed-case input compare with `normalizeEmail` instead.
affects: all
-->
