---
"@cosmicdrift/kumiko-bundled-features": patch
---

Token mails show the expiry in the recipient's own time zone

Password reset, email verification and account unlock are requested anonymously, so `ctx.tz.user` only held the tenant default or UTC. These mails now use the recipient's profile time zone when it is a valid IANA zone and fall back to the previous value otherwise. Signup and invite mails keep the fallback because the recipient has no profile yet.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Token mail expiry uses the recipient's profile time zone
-->
