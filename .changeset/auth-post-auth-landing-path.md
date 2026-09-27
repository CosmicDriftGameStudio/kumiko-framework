---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

auth routes return a server-computed landingPath from auth.postAuthLanding

`AuthRoutesConfig.postAuthLanding` lets an app resolve, in one server-side place, where a user lands after auth instead of every frontend screen re-deriving it from roles/tenantId. The resolver runs for login, mfa-verify, mfa-preauth-confirm, signup-confirm, and all three invite-accept branches, and its result is validated (root-relative only, no protocol-relative/backslash/control-character paths, no cross-origin resolution) before it is ever added to the response as `landingPath`. An invalid path or a throwing resolver just omits the field — auth never fails because of it.

`run-prod-app`'s and `run-dev-app`'s auth options now accept `postAuthLanding` and thread it through to the framework config unchanged.

`SignupCompleteScreen` and `InviteAcceptScreen` now prefer the server's `landingPath` over their `loggedInHref` prop, which becomes a deprecated per-app fallback for apps that haven't configured a resolver yet.

Closes #3320.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: auth routes return a server-computed landingPath from auth.postAuthLanding
-->
