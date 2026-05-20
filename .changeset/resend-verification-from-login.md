---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

feat(auth-email-password): "Bestätigungs-Mail erneut senden" im LoginScreen

LoginScreen bietet bei reason=email_not_verified jetzt einen Resend-Link
im Fehler-Banner — der existierende `requestEmailVerification`-Endpoint
wird direkt aufgerufen, der Banner wechselt nach Erfolg zum Info-Variant
("Wir haben dir eine neue Bestätigungs-Mail geschickt.").

UX-Details:
- Bei 429 → inline-Hint "Bitte warte kurz und versuche es erneut."
- Bei Netzwerk/sonstigen Fehlern → inline-Hint "Konnte nicht senden."
- Anti-Typo-Gate: ändert der User die Email-Eingabe nach dem Login-Fail,
  verschwindet der Resend-Link — sonst würde Resend silent-success an die
  geänderte (potentiell typoed) Adresse gehen ohne User-Feedback.
- Andere Failure-Codes (invalid_credentials etc.) zeigen weiterhin keinen
  Resend-Link.

i18n: 4 neue Keys (DE+EN) im `auth.login.resend*`-Namespace, additive.
Apps die ihre Translations override-en müssen nichts ändern.

Additive UI-Feature — keine API-Breaks, keine Schema-Migration.
