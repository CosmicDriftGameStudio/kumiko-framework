---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-feature-ast": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"create-kumiko-app": patch
"@cosmicdrift/kumiko-samples": patch
---

Public handlers admit signed-in visitors whatever their roles (`anySignedIn`), the contact website client types ship under `contact/client`, the report form names the app and Telegram is documented as optional.

<!-- kumiko-changes
feature: framework
type: improvement
title: anySignedIn: public handlers admit every signed-in caller
detail: A role rule that includes `anonymous` may add `anySignedIn: true` (`{ roles: ["anonymous"], anySignedIn: true }`). A signed-in caller then passes whatever roles the session carries, because the browser sends the session cookie to a public endpoint and an app-specific role (for example "Hausmeister") used to turn away a visitor who is welcome anonymously. `hasAccess` and `isUiAccessGranted` honour the flag, nav entries with such a rule stay visible to every viewer, and feature-ast reads and writes it. The boot validator rejects `anySignedIn` on a rule without `anonymous` (use `openToAll` for "every signed-in user") and any value other than `true` (rule `handler/any-signed-in-invalid`). The public handlers of bundled features now set it: waitlist submit, contact challenge and submit, user-data-rights deletion by email and token and download by token, managed-pages published pages and branding, file-derivatives public variants, compliance-profiles sub-processors, tenant-inactivity keep-account, auth-email-password login options and self-registration status, template-resolver by tenant and slug, seo config and subscription-paddle checkout config. Anonymous-only auth flows (signup, reset password, verify email, invite info, account unlock, MFA preauth) are unchanged.
-->

<!-- kumiko-changes
feature: contact
type: improvement
title: contact/client subpath, app name in the report hint, Telegram documented as optional
detail: `@cosmicdrift/kumiko-bundled-features/contact/client` exports `CONTACT_CLIENT_SOURCE` and the website client types `ContactWebsiteClient`, `ContactWebsiteWindow`, `ContactWebsiteSubmitFields`, `ContactWebsiteSubmitResult`, `ContactWebsiteFormOptions` and `ContactWebsiteKind`. The report form hint reads "Goes straight to the {appName} team" with the `appName` option (de, en, es, fr, it). With the default `telegram: false` the feature lists `channel-telegram` as an optional dependency only; the feature manifest, the recipe and the docs no longer show the Telegram config key or `contact:write:send-test` for that default. A signed-in visitor with any role can submit the website form and fetch the challenge.
-->

<!-- kumiko-changes
feature: waitlist
type: fix
title: Signed-in visitors can join the waitlist whatever their roles
detail: `waitlist:write:submit` used to answer 403 when the browser sent the session cookie of a user without one of the listed roles. It now admits every signed-in caller through `anySignedIn`.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm summary params
detail: `summary.params` (`Record<string, string>`) of an actionForm screen interpolates fixed values, such as an app name a feature option sets, into the summary title and subtitle. They are merged with the formatted drawer prefill and win on a name clash.
-->
