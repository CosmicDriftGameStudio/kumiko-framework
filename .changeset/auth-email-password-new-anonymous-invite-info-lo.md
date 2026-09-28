---
"@cosmicdrift/kumiko-bundled-features": minor
---

New anonymous invite-info lookup route; invite-accept-with-login now returns invalid_credentials for a wrong or missing password

POST /auth/invite-info ({token} -> {email, hasAccount}) lets an invite-acceptance page pre-fill the email and show a login-vs-signup form without consuming the token; it 422s invalid_invite_token for any unknown/non-pending token, same as the accept routes. invite-accept-with-login's wrong-password and no-password-set branches now return 422 invalid_credentials instead of collapsing into invalid_invite_token — safe to reveal because reaching that branch already required a valid, open invite token plus the matching invitation email.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: New anonymous invite-info lookup route; invite-accept-with-login now returns invalid_credentials for a wrong or missing password
migration: |
  No action needed for apps using createAuthEmailPasswordFeature's default wiring via runProdApp/runDevApp — the new route only mounts when the host app's auth-routes config sets invite.infoHandler (runProdApp/runDevApp now do this automatically when the invite feature is enabled). A client that special-cased invite-accept-with-login's invalid_invite_token response to also mean "wrong password" should switch to matching invalid_credentials for that case.
-->
