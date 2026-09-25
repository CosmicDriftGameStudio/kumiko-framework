---
"@cosmicdrift/kumiko-bundled-features": minor
---

SignupCompleteScreen passes the claimed handover to loggedInHref

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: SignupCompleteScreen passes the claimed handover to loggedInHref
detail: |
  The function form of `loggedInHref` on `SignupCompleteScreen` now receives
  an optional `handover: { entityType, id }` next to `tenantKey`/`roles`,
  mirroring the `handover` field `confirmSignup` already returns when a
  try-first tenant-handover grant was claimed during signup. Apps can route a
  freshly activated user straight to the entity they claimed (offlot-app#454)
  instead of a fixed landing page. The string form and callers that ignore the
  extra field are unaffected.
-->
