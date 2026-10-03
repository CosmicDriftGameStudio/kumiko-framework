---
"@cosmicdrift/kumiko-bundled-features": minor
---

emailPasswordClient accepts loginUrl and postLogoutUrl for external login pages

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: emailPasswordClient({ loginUrl, postLogoutUrl }) sends unauthenticated visitors to an external login page with a same-origin next path and navigates there on logout
migration: |
  No code change needed.
-->
