// @runtime client
// Default-Bundles für die auth-mfa Feature-UI. Merged in mit
// authMfaClient() analog zu emailPasswordClient() aus auth-email-password.
// Keys folgen `auth.mfa.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "screen:auth-mfa-enable.title": "Zwei-Faktor-Authentifizierung",
    "auth.mfa.verify.title": "Zwei-Faktor-Bestätigung",
    "auth.mfa.verify.subtitle": "Gib den 6-stelligen Code aus deiner Authenticator-App ein.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Bestätigen",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.verify.backToLogin": "Zurück zum Login",
    "auth.mfa.errors.invalidCode": "Ungültiger Code. Bitte erneut versuchen.",
    "auth.mfa.errors.invalidTotpCode": "Ungültiger Code. Bitte erneut versuchen.",
    "auth.mfa.errors.invalidChallengeToken":
      "Die Anmeldung ist abgelaufen. Bitte erneut einloggen.",
    "auth.mfa.errors.challengeExpired": "Die Anmeldung ist abgelaufen. Bitte erneut einloggen.",
    "auth.mfa.errors.tooManyAttempts": "Zu viele Fehlversuche. Bitte erneut einloggen.",
    "auth.mfa.errors.tooManyAttemptsWithSeconds":
      "Zu viele Fehlversuche. Bitte in {seconds} Sekunden erneut versuchen oder neu einloggen.",
    "auth.mfa.errors.verifyFailed": "Bestätigung fehlgeschlagen.",
    "auth.mfa.errors.mfaAlreadyEnabled": "Zwei-Faktor-Authentifizierung ist bereits aktiv.",
    "auth.mfa.errors.mfaNotEnabled": "Zwei-Faktor-Authentifizierung ist nicht aktiv.",
    "auth.mfa.errors.invalidSetupToken": "Die Einrichtung ist abgelaufen. Bitte erneut starten.",
    "auth.mfa.errors.setupFailed": "Einrichtung fehlgeschlagen. Bitte erneut versuchen.",
    "auth.mfa.errors.invalidRecoveryCode": "Ungültiger Recovery-Code.",
    "auth.mfa.enable.title": "Zwei-Faktor-Authentifizierung",
    "auth.mfa.enable.intro":
      "Schütze dein Konto zusätzlich mit einer Authenticator-App (z.B. Google Authenticator, 1Password).",
    "auth.mfa.enable.start": "Einrichtung starten",
    "auth.mfa.enable.scanTitle": "QR-Code scannen",
    "auth.mfa.enable.manualEntry": "Oder manuell eingeben:",
    "auth.mfa.enable.recoveryTitle": "Recovery-Codes",
    "auth.mfa.enable.recoveryHint":
      "Speichere diese Codes an einem sicheren Ort. Sie werden nur dieses eine Mal angezeigt und erlauben dir den Zugriff, falls du dein Gerät verlierst.",
    "auth.mfa.enable.acknowledge": "Ich habe die Recovery-Codes gespeichert.",
    "auth.mfa.enable.code": "Code aus der Authenticator-App",
    "auth.mfa.enable.cancel": "Abbrechen",
    "auth.mfa.enable.confirm": "Aktivieren",
    "auth.mfa.enable.success": "Zwei-Faktor-Authentifizierung ist jetzt aktiv.",
    "auth.mfa.setup.title": "Zwei-Faktor-Authentifizierung erforderlich",
    "auth.mfa.setup.subtitle":
      "Dein Konto verlangt Zwei-Faktor-Authentifizierung. Richte sie jetzt ein, um dich anzumelden.",
    "auth.mfa.setup.intro":
      "Scanne den QR-Code mit einer Authenticator-App (z.B. Google Authenticator, 1Password).",
    "auth.mfa.setup.start": "Einrichtung starten",
    "auth.mfa.setup.confirm": "Einrichtung abschließen",
    "auth.mfa.disable.title": "Zwei-Faktor-Authentifizierung deaktivieren",
    "auth.mfa.disable.description":
      "Bestätige mit einem Code aus deiner Authenticator-App oder einem Recovery-Code. Dein Konto ist danach nur noch durch dein Passwort geschützt.",
    "auth.mfa.disable.code": "Code aus der Authenticator-App oder Recovery-Code",
    "auth.mfa.disable.confirm": "Deaktivieren",
    "auth.mfa.disable.cancel": "Abbrechen",
    "auth.mfa.disable.trigger": "Zwei-Faktor-Authentifizierung deaktivieren",
    "auth.mfa.regenerate.title": "Neue Recovery-Codes erzeugen",
    "auth.mfa.regenerate.description":
      "Bestätige mit einem Code aus deiner Authenticator-App. Alle bisherigen Recovery-Codes werden sofort ungültig.",
    "auth.mfa.regenerate.code": "Code aus der Authenticator-App",
    "auth.mfa.regenerate.confirm": "Neu erzeugen",
    "auth.mfa.regenerate.cancel": "Abbrechen",
    "auth.mfa.regenerate.trigger": "Neue Recovery-Codes erzeugen",
    "auth.mfa.regenerate.newCodesTitle": "Deine neuen Recovery-Codes",
    "auth.mfa.regenerate.newCodesHint":
      "Speichere diese Codes an einem sicheren Ort. Die alten Codes funktionieren ab sofort nicht mehr.",
    "auth.mfa.regenerate.acknowledge": "Ich habe die neuen Recovery-Codes gespeichert.",
    "auth.mfa.regenerate.done": "Fertig",
  },
  en: {
    "screen:auth-mfa-enable.title": "Two-factor authentication",
    "auth.mfa.verify.title": "Two-factor verification",
    "auth.mfa.verify.subtitle": "Enter the 6-digit code from your authenticator app.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Verify",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.verify.backToLogin": "Back to login",
    "auth.mfa.errors.invalidCode": "Invalid code. Please try again.",
    "auth.mfa.errors.invalidTotpCode": "Invalid code. Please try again.",
    "auth.mfa.errors.invalidChallengeToken": "Your sign-in has expired. Please sign in again.",
    "auth.mfa.errors.challengeExpired": "Your sign-in has expired. Please sign in again.",
    "auth.mfa.errors.tooManyAttempts": "Too many failed attempts. Please sign in again.",
    "auth.mfa.errors.tooManyAttemptsWithSeconds":
      "Too many failed attempts. Try again in {seconds} seconds, or sign in again.",
    "auth.mfa.errors.verifyFailed": "Verification failed.",
    "auth.mfa.errors.mfaAlreadyEnabled": "Two-factor authentication is already enabled.",
    "auth.mfa.errors.mfaNotEnabled": "Two-factor authentication is not enabled.",
    "auth.mfa.errors.invalidSetupToken": "Setup expired. Please start again.",
    "auth.mfa.errors.setupFailed": "Setup failed. Please try again.",
    "auth.mfa.errors.invalidRecoveryCode": "Invalid recovery code.",
    "auth.mfa.enable.title": "Two-factor authentication",
    "auth.mfa.enable.intro":
      "Add an extra layer of protection with an authenticator app (e.g. Google Authenticator, 1Password).",
    "auth.mfa.enable.start": "Start setup",
    "auth.mfa.enable.scanTitle": "Scan the QR code",
    "auth.mfa.enable.manualEntry": "Or enter manually:",
    "auth.mfa.enable.recoveryTitle": "Recovery codes",
    "auth.mfa.enable.recoveryHint":
      "Save these codes somewhere safe. They're shown only this once and let you back in if you lose your device.",
    "auth.mfa.enable.acknowledge": "I've saved my recovery codes.",
    "auth.mfa.enable.code": "Code from your authenticator app",
    "auth.mfa.enable.cancel": "Cancel",
    "auth.mfa.enable.confirm": "Enable",
    "auth.mfa.enable.success": "Two-factor authentication is now enabled.",
    "auth.mfa.setup.title": "Two-factor authentication required",
    "auth.mfa.setup.subtitle":
      "Your account requires two-factor authentication. Set it up now to sign in.",
    "auth.mfa.setup.intro":
      "Scan the QR code with an authenticator app (e.g. Google Authenticator, 1Password).",
    "auth.mfa.setup.start": "Start setup",
    "auth.mfa.setup.confirm": "Complete setup",
    "auth.mfa.disable.title": "Disable two-factor authentication",
    "auth.mfa.disable.description":
      "Confirm with a code from your authenticator app or a recovery code. Your account will then be protected by your password alone.",
    "auth.mfa.disable.code": "Code from your authenticator app or a recovery code",
    "auth.mfa.disable.confirm": "Disable",
    "auth.mfa.disable.cancel": "Cancel",
    "auth.mfa.disable.trigger": "Disable two-factor authentication",
    "auth.mfa.regenerate.title": "Generate new recovery codes",
    "auth.mfa.regenerate.description":
      "Confirm with a code from your authenticator app. All existing recovery codes stop working immediately.",
    "auth.mfa.regenerate.code": "Code from your authenticator app",
    "auth.mfa.regenerate.confirm": "Generate new codes",
    "auth.mfa.regenerate.cancel": "Cancel",
    "auth.mfa.regenerate.trigger": "Generate new recovery codes",
    "auth.mfa.regenerate.newCodesTitle": "Your new recovery codes",
    "auth.mfa.regenerate.newCodesHint":
      "Save these codes somewhere safe. The old codes stop working immediately.",
    "auth.mfa.regenerate.acknowledge": "I've saved my new recovery codes.",
    "auth.mfa.regenerate.done": "Done",
  },
  es: {
    "screen:auth-mfa-enable.title": "Verificación en dos pasos",
    "auth.mfa.verify.title": "Verificación en dos pasos",
    "auth.mfa.verify.subtitle": "Introduce el código de 6 dígitos de tu app de autenticación.",
    "auth.mfa.verify.code": "Código",
    "auth.mfa.verify.submit": "Confirmar",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.verify.backToLogin": "Volver al inicio de sesión",
    "auth.mfa.errors.invalidCode": "Código no válido. Inténtalo de nuevo.",
    "auth.mfa.errors.invalidTotpCode": "Código no válido. Inténtalo de nuevo.",
    "auth.mfa.errors.invalidChallengeToken":
      "Tu inicio de sesión ha caducado. Vuelve a iniciar sesión.",
    "auth.mfa.errors.challengeExpired": "Tu inicio de sesión ha caducado. Vuelve a iniciar sesión.",
    "auth.mfa.errors.tooManyAttempts": "Demasiados intentos fallidos. Vuelve a iniciar sesión.",
    "auth.mfa.errors.tooManyAttemptsWithSeconds":
      "Demasiados intentos fallidos. Inténtalo de nuevo en {seconds} segundos o vuelve a iniciar sesión.",
    "auth.mfa.errors.verifyFailed": "Error al confirmar.",
    "auth.mfa.errors.mfaAlreadyEnabled": "La verificación en dos pasos ya está activada.",
    "auth.mfa.errors.mfaNotEnabled": "La verificación en dos pasos no está activada.",
    "auth.mfa.errors.invalidSetupToken": "La configuración ha caducado. Vuelve a empezar.",
    "auth.mfa.errors.setupFailed": "Error al configurar. Inténtalo de nuevo.",
    "auth.mfa.errors.invalidRecoveryCode": "Código de recuperación no válido.",
    "auth.mfa.enable.title": "Verificación en dos pasos",
    "auth.mfa.enable.intro":
      "Protege tu cuenta con una capa adicional usando una app de autenticación (p. ej. Google Authenticator, 1Password).",
    "auth.mfa.enable.start": "Iniciar configuración",
    "auth.mfa.enable.scanTitle": "Escanea el código QR",
    "auth.mfa.enable.manualEntry": "O introdúcelo manualmente:",
    "auth.mfa.enable.recoveryTitle": "Códigos de recuperación",
    "auth.mfa.enable.recoveryHint":
      "Guarda estos códigos en un lugar seguro. Solo se muestran esta vez y te permiten entrar si pierdes tu dispositivo.",
    "auth.mfa.enable.acknowledge": "He guardado mis códigos de recuperación.",
    "auth.mfa.enable.code": "Código de la app de autenticación",
    "auth.mfa.enable.cancel": "Cancelar",
    "auth.mfa.enable.confirm": "Activar",
    "auth.mfa.enable.success": "Ya tienes activada la verificación en dos pasos.",
    "auth.mfa.setup.title": "Se requiere verificación en dos pasos",
    "auth.mfa.setup.subtitle":
      "Tu cuenta requiere verificación en dos pasos. Configúrala ahora para iniciar sesión.",
    "auth.mfa.setup.intro":
      "Escanea el código QR con una app de autenticación (p. ej. Google Authenticator, 1Password).",
    "auth.mfa.setup.start": "Iniciar configuración",
    "auth.mfa.setup.confirm": "Completar configuración",
    "auth.mfa.disable.title": "Desactivar la verificación en dos pasos",
    "auth.mfa.disable.description":
      "Confirma con un código de tu app de autenticación o un código de recuperación. Después, tu cuenta solo estará protegida por tu contraseña.",
    "auth.mfa.disable.code": "Código de la app de autenticación o código de recuperación",
    "auth.mfa.disable.confirm": "Desactivar",
    "auth.mfa.disable.cancel": "Cancelar",
    "auth.mfa.disable.trigger": "Desactivar la verificación en dos pasos",
    "auth.mfa.regenerate.title": "Generar nuevos códigos de recuperación",
    "auth.mfa.regenerate.description":
      "Confirma con un código de tu app de autenticación. Todos los códigos de recuperación anteriores dejarán de funcionar de inmediato.",
    "auth.mfa.regenerate.code": "Código de la app de autenticación",
    "auth.mfa.regenerate.confirm": "Generar de nuevo",
    "auth.mfa.regenerate.cancel": "Cancelar",
    "auth.mfa.regenerate.trigger": "Generar nuevos códigos de recuperación",
    "auth.mfa.regenerate.newCodesTitle": "Tus nuevos códigos de recuperación",
    "auth.mfa.regenerate.newCodesHint":
      "Guarda estos códigos en un lugar seguro. Los códigos antiguos dejan de funcionar de inmediato.",
    "auth.mfa.regenerate.acknowledge": "He guardado mis nuevos códigos de recuperación.",
    "auth.mfa.regenerate.done": "Listo",
  },
};

export { mergeTranslations } from "@cosmicdrift/kumiko-renderer";
