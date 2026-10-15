---
status: reference
verified: 2026-10-03
evidence: "kumiko-framework#2334 (Browser-Locale → Server + lokalisierte Magic-Link-Mails); #2343 (persisted SessionUser.locale im JWT); api/request-context.ts; api/jwt.ts; #3511 (Mail-Locale, jetzt Vorlagen pro Locale)"
---

# User-Locale: vom Browser bis in Mails und Hintergrund-Jobs

Die Wunsch-Locale eines Users wird end-to-end transportiert — vom Browser
an den Server, in den Session-JWT und in ausgelöste Mails/Jobs. So rendert
z. B. eine Magic-Link-Mail in der Locale des Absenders, nicht in einem
Server-Default.

## 1. Browser → Server (`X-Locale`, fw#2334)

- Der Client setzt `document.documentElement.lang` und sendet sie als
  **`X-Locale`-Header** (bzw. `Accept-Language`) mit jeder Anfrage
  (`LOCALE_HEADER_NAME`, `request-context.ts`).
- Der Server stellt daraus ein **immer vorhandenes `ctx.locale`** bereit —
  Handler können Locale-abhängig antworten oder Mails ableiten.

## 2. Session-Persistenz (`SessionUser.locale` im JWT, fw#2343)

- Die vom User gewählte Locale wird **bei Login in den JWT übernommen**
  (`locale`-Claim) und durch Login/Invite-Accept/MFA-Handler durchgereicht.
- `SessionUser.locale` überlebt damit **Cross-Device und Hintergrund-Jobs**:
  ein Job, der im Namen des Users eine Mail erzeugt, kennt dessen Locale.
- `ctx.locale` fällt nach dem Live-Signal (X-Locale) auf `SessionUser.locale`
  zurück — konsistente Locale, auch wenn der aktuelle Request keine
  Browser-Locale trägt.

## 3. Lokalisierte Magic-Link-Mails (fw#2334)

Alle Auth-Mails (Signup, Password-Reset, Email-Verification, Invite,
Account-Unlock) werden in der **Locale des Anfragenden** gerendert.

- `appUrl` kann eine Funktion `(locale) => string` sein, um den Link
  Locale-getreu (z. B. `/de/...`) zu bauen.
- Mails nutzen `ctx.locale` / `SessionUser.locale` statt eines Server-Enums.

## 4. Mail-Vorlagen pro Locale (fw#3511)

`ctx.notify(type, { locale })` reicht die Locale über `ChannelMessage` und die
Jobs `delivery.render`/`delivery.send` bis an `renderer.render({ locale })`.
Die Auth- und Consumer-Protection-Mails setzen sie mit der Locale, in der sie
ihren Inhalt übersetzen.

Der Mail-Renderer (`renderer-mail-html`) lädt die Vorlage zu dieser Locale über den
Template-Resolver (Tenant-Override vor System-Text, dann die Fallback-Locale des
Resolvers). Absender wählen eine Locale, für die die Notification eine Vorlage
deklariert (`template`/`localizedTemplate` an `r.notification`).

## Kernregel

- **Neue Ausgangs-Mails**: immer Locale aus `ctx.locale` (Fallback
  `SessionUser.locale`) ableiten — nie einen Server-Default hart coden.
- **`appUrl` als `(locale) => string`** verwenden, wenn der Lande-Pfad
  locale-sensitiv ist.
