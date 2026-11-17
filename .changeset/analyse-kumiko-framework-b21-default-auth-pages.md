---
"@cosmicdrift/kumiko-bundled-features": minor
---

The default auth pages of the web auth client also serve signup, signup completion, email verification and invite acceptance, follow custom auth paths and take an auth shell.

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Default auth pages cover every auth path and take a shell
detail: `emailPasswordClient({ defaultAuthPages })` now takes `false` or `{ paths?: Partial<AuthPaths> }`; `true` is no longer accepted. Besides forgot-password, reset-password and unlock-account, signed-out visitors now get `/signup` (only when the server registers the signup status query; a visitor with a session cookie passes through), `/signup/complete`, `/verify-email` and `/invite/accept`, each at the path from `paths`, resolved like the server's `auth.mail.paths`. Login links on these pages point to `/login` under the app base path. The new option `authShell` wraps every auth card through `AuthShellProvider`.
migration: Replace `defaultAuthPages: true` with no option. Apps that pass custom `auth.mail.paths` to the server pass the same object as `defaultAuthPages: { paths }`. Delete app gates that only mounted these screens, and pass the shell as `authShell` instead of wrapping `AuthShellProvider` in an own gate. Keep an own earlier gate only for screens that need app-specific props.
-->
