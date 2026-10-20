---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-document-designer": minor
---

Security, performance and auth defaults: CSP script hashes for hostDispatch pages, a batched file-meta route, lazy editors and pickers, a per-tenant override count in the template overview, and forgot-password and account-unlock wired by default.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: hostDispatch pages get the build's CSP script hashes
detail: The deps passed to hostDispatch now carry cspScriptHashes (the inline-script hashes from csp-hashes.json). Build the page CSP with buildDefaultCsp(deps.cspScriptHashes), now exported, so per-host pages keep script-src without unsafe-inline. runDevApp passes an empty list because dev serves no per-host CSP.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: GET /files/meta?ids= returns file metadata in one request
detail: Up to 100 comma-separated file ids per call (more answers 400 too_many_ids). The same tenant and access checks as /files/:id/meta apply per id; unknown, foreign and invalid ids are left out of the answer. The renderer's file thumbnails and file names batch their lookups through it, so a list of N files no longer issues N meta requests.
-->

<!-- kumiko-changes
feature: bundled-features
type: improvement
title: Template overview reports tenant overrides per template
detail: template-resolver has a SystemAdmin query tenant-override-counts, and the overview rows for system templates carry overriddenBy { active, total } for SystemAdmins. The designer's overview reads it instead of issuing one tenant-overrides query per row. Reading it uses a declared unsafeRaw escape hatch because it counts across tenants.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: DayPicker and QR code load on demand
detail: The calendar popover and the QR secret value import react-day-picker and qrcode lazily, so screens without a date input or an MFA setup no longer ship them. Date popovers render their grid one tick later; tests should use findBy queries.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Layout, mail and PDF template editors load lazily
detail: The editors are split into their own chunks and show a loading state while they load. The PdfTemplateEditor export of the web barrel is unchanged.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Forgot-password and account-unlock work without app wiring
detail: With auth.mail and SMTP configured, runProdApp and runDevApp now also wire the account-unlock flow (POST /api/auth/request-account-unlock and /api/auth/confirm-account-unlock, mail link to /unlock-account) because the login lockout is always on. emailPasswordClient serves ForgotPasswordScreen, ResetPasswordScreen (with token) and the unlock screens at /forgot-password, /reset-password and /unlock-account; gates registered earlier by the app win, and defaultAuthPages: false turns it off. LoginScreen reads the new anonymous login-options query and shows the forgot and unlock links when the flows exist; explicit forgotPasswordHref and unlockAccountHref still win and null hides a link. The query needs anonymousAccess on the app, otherwise no link appears.
-->

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: Privacy center subtitle no longer mentions deletion when it is hidden
detail: With privacyCenterShowDeletion false the screen description uses the new key userDataRights.privacyCenter.subtitleWithoutDeletion (English, German, French, Spanish and Italian provided) instead of the text that names Art. 17.
-->
