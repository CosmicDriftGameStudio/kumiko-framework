---
"@cosmicdrift/kumiko-bundled-features": minor
---

Login, password reset and user creation treat an email address the same regardless of upper or lower case.

<!-- kumiko-changes
feature: user
type: breaking
title: User email lookups and writes are case-insensitive
detail: `user:find-for-auth`, `user:create` and `user:update` lowercase the email in their schema, `seedUser` and the signup guard lowercase it before lookup and insert, and `login` lowercases before the lookup and the unknown-email lockout count. Before, the blind index compared byte-exact, so `Max@Firma.de` failed to log in to `max@firma.de` and `user:create` could add a second account for the same address in other casing. Emails returned by these handlers are now always lowercase. The admin boot seed (`seedAdminGuarded`, `seedBootstrapAdmin`, `ensureBootstrapAdminRoles`) still finds an account stored with upper case and rewrites its email to lower case.
migration: Stored emails that contain upper case letters are no longer found by login and the regular lookups until they are lowercased; the admin boot seed repairs the seeded admin account itself. Callers that compared a returned email against mixed-case input compare with `normalizeEmail` instead.
affects: all
-->
