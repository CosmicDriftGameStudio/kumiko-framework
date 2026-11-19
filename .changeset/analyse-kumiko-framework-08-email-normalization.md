---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": patch
---

Login, password reset and user creation treat an email address the same regardless of upper or lower case.

<!-- kumiko-changes
feature: user
type: breaking
title: User email lookups and writes are case-insensitive
detail: `user:find-for-auth`, `user:create` and `user:update` lowercase the email in their schema, `seedUser` and the signup guard lowercase it before lookup and insert, and `login` lowercases before the lookup and the unknown-email lockout count. Before, the blind index compared byte-exact, so `Max@Firma.de` failed to log in to `max@firma.de` and `user:create` could add a second account for the same address in other casing. Emails returned by these handlers are now always lowercase, and `user-data-rights:write:request-deletion-by-email` lowercases its input too. The admin boot seed (`seedAdminGuarded`, `seedBootstrapAdmin`, `ensureBootstrapAdminRoles`) still finds an account stored with upper case and rewrites its email to lower case. `runProdApp` and `runWorkerApp` lowercase every other stored email on each boot in the background through the executor (`normalizeStoredUserEmails` from `@cosmicdrift/kumiko-bundled-features/user`), so the event and the blind index follow.
migration: Nothing to do for accounts stored with upper case; the boot step repairs them. When the lowercase address already belongs to another live account, the boot step leaves both accounts unchanged and logs the count and the user ids as a warning ("user accounts whose lower-cased email belongs to another live account"); decide per pair which account stays and merge or delete the other one. Callers that compared a returned email against mixed-case input compare with `normalizeEmail` instead.
affects: all
-->
