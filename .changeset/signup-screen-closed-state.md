---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

SignupScreen reads the signup registration status and shows a closed state when self-registration is off, and the waitlist feature ships a public sign-up screen.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: SignupScreen shows a closed state while self-registration is off
detail: With a mounted dispatcher the screen asks `auth-email-password:query:signup-registration-status`. While `enabled` is false it renders the notice `auth.signup.closed` (de: "Die Registrierung ist derzeit nur mit Einladung möglich.") plus the login link instead of the form, and sends nothing. The new prop `closedFallback?: ReactNode` replaces the whole signup card (no nested card), so an app can render its own sign-up there, for example a waitlist form built on `waitlist:write:submit`; the waitlist feature ships no public screen of its own. A failed status query reads as open. The status query needs a mounted `DispatcherProvider`; in standalone auth mounts without one the form always shows and the server still rejects `signup-request`. New key `auth.signup.closed` in en, de, es, fr and it.
-->

<!-- kumiko-changes
feature: waitlist
type: improvement
title: WaitlistSubmitScreen, a public waitlist sign-up screen
detail: `@cosmicdrift/kumiko-bundled-features/waitlist/web` exports `WaitlistSubmitScreen` (props `title`, `subtitle`, `loginHref`), `waitlistClient()` for its translations and `defaultTranslations`. The screen posts name, email, optional company and message, the current locale and the honeypot field `website` anonymously to `waitlist:write:submit`, then shows a confirmation. Pass it as `closedFallback` of `SignupScreen` to offer the waitlist while self-registration is off. Keys `waitlist.public.*` ship in en, de (informal and formal), es, fr and it.
-->
