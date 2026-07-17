---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": minor
---

Fix-Batch aus dem PR-Review-Prozess (Quellen: #1035, #1036, #1037, #1041, #1042,
#1043, #1049, #1050, #1052, #1053, #1056, #1064, #1034).

- `@cosmicdrift/kumiko-framework/engine` exportiert neu `isEncryptedAtRest(def)` —
  ein Config-Key gilt als verschlüsselt wenn `encrypted: true` ODER
  `backing: "secrets"` gesetzt ist. Ersetzt drei bisher unabhängig abweichende
  Ableitungen (feature-manifest.ts, cascade/values.query.ts) und schließt eine
  Boot-Validator-Lücke: `computed`/`allowPerRequest` auf einem
  `backing: "secrets"`-Key failt jetzt am Boot statt zur Laufzeit durchzurutschen.
- `RunProdAppOptions` bekommt `observabilityOptions` (Passthrough zur
  Auto-Instrumentation) — vorher nur über den Low-Level-Entrypoint erreichbar.
- `@cosmicdrift/kumiko-bundled-features/auth-mfa`: `currentTotpCode` (Test-Hook,
  nie ein Runtime-Helper) zieht aus dem Haupt-Barrel in einen neuen
  `./auth-mfa/testing`-Subpath — Import-Pfad ändert sich für Tests, die den
  Live-Code direkt aus einem Secret ableiten wollen.
- MFA-Enrollment-UI: `mfa-enable-screen.tsx` importiert `qrcode/lib/browser`
  statt `qrcode` (vermeidet Node-only Deps wie yargs/pngjs im Client-Bundle;
  Bundle-Impact lokal nicht verifiziert), fängt Fehler jetzt in try/catch statt
  den Busy-State hängen zu lassen. `mfa-verify-screen.tsx` bekommt ein
  optionales `onCancel`, damit dead-end-Fehler (challenge_expired,
  too_many_attempts) einen Weg zurück zum Login haben.
- Diverse Low-Sev-Fixes: base32-Decode toleriert `=`-Padding und validiert
  Restbits, Rate-Limit-Fix im public-share-token-Recipe (ip+handler statt
  user+handler bei openToAll), i18n-Lücken (mfa_not_supported-Key,
  styleguide-Sample-Übersetzungen), tote Kommentar-Blöcke gekürzt,
  password-hashing-Imports innerhalb bundled-features auf die tatsächliche
  `shared/`-Quelle umgestellt (Barrel-Re-Export in `auth-email-password`
  bewusst NICHT entfernt — bleibt als öffentlicher Re-Export bestehen, da eine
  Entfernung ein Breaking Change für published Consumers wäre und ein eigenes
  Deprecation-Fenster braucht).
