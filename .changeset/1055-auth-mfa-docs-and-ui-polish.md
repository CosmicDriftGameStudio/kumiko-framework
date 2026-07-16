---
"@cosmicdrift/kumiko-bundled-features": patch
---

`MfaEnableScreen` (auth-mfa) now uses the `Section` primitive instead of a hand-rolled `Card` + footer `div`, matching the standard standalone-card pattern (`privacy-center-screen.tsx`) — correct footer border/background and spacing instead of ad hoc styling. The QR-code enrollment block is now centered instead of left-aligned. Also fixes the screen's title breadcrumb showing the raw i18n key (`screen:auth-mfa-enable.title`) instead of the translated label — the key was registered server-side only, never shipped to the client translation bundle.
