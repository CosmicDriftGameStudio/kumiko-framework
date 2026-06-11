---
"@cosmicdrift/kumiko-bundled-features": minor
---

Neues bundled feature `user-profile` — Self-Service-Kontoseite:

- `user-profile:write:change-email`: E-Mail ändern mit Re-Auth
  (aktuelles Passwort), Uniqueness-Check und `emailVerified`-Reset;
  der Screen triggert anschließend den Verification-Flow.
- `ProfileScreen`-Web-Komponente (Passwort ändern via
  auth-email-password, E-Mail ändern, Konto löschen / Löschung
  abbrechen via user-data-rights mit Grace-Period und Dialog-Confirm)
  + `userProfileClient()` mit de/en-Bundles.
- Requires `user`, `auth-email-password`, `user-data-rights`.
- Recipe `samples/recipes/user-profile` zeigt das App-Wiring
  (custom-Screen + `__component: "UserProfileScreen"`).
