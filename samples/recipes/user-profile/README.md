# user-profile

Self-Service-Kontoseite als bundled feature: Passwort ändern
(`auth-email-password:write:change-password`), E-Mail ändern mit
Re-Auth + Verification-Reset (`user-profile:write:change-email`),
Konto löschen / Löschung abbrechen (`user-data-rights` mit
Grace-Period).

Das Feature liefert Handler + `ProfileScreen`-Komponente + i18n;
die App deklariert den Screen selbst (siehe `src/feature.ts`):

- Server: `r.screen({ type: "custom", renderer: { react: { __component: "UserProfileScreen" } } })`
- Client: `components: { UserProfileScreen: ProfileScreen }` +
  `clientFeatures: [userProfileClient()]`

Require-Kette: `user`, `auth-email-password`, `user-data-rights`
(letzteres zieht `data-retention`, `compliance-profiles`, `sessions`) —
`composeAccountApp()` zeigt die volle Komposition.
