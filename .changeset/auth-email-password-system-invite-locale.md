---
"@cosmicdrift/kumiko-bundled-features": patch
---

systemInviteCreate accepts an optional locale for the invitation mail

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: systemInviteCreate takes an optional locale tag
detail: The payload accepts a locale (BCP 47 tag) that wins over the request locale when rendering the invitation mail, so system callers such as the waitlist can invite in the recipient's language.
-->
