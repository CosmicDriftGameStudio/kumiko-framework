---
"@cosmicdrift/kumiko-bundled-features": minor
---

Anonymous signup-confirm and invite-signup-complete (auth-email-password) and verify / enable-confirm-preauth (auth-mfa) declare personalData: public-intake, since they write personal data through a TenantDb derived from ctx.db.unsafeRaw (fw#3185)

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Anonymous signup-confirm and invite-signup-complete (auth-email-password) and verify / enable-confirm-preauth (auth-mfa) declare personalData: public-intake, since they write personal data through a TenantDb derived from ctx.db.unsafeRaw (fw#3185)
-->
