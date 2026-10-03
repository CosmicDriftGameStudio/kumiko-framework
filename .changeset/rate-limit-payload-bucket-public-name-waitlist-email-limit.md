---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

A 429 caused by a payload bucket (`additionalRateLimits`) no longer carries the HMAC digest of the bucketed value in `details.bucket` or the error message: it reads `payload+handler:<handler>:<field>`. The digest is a stable pseudonym of the address, so anyone who could guess an address could confirm it from the response. Redis keys are unchanged.

`waitlist:write:submit` additionally limits each email address (case-insensitive) to 3 submits per day, across all IPs, so a botnet cannot flood one address with confirmation mails. `createWaitlistFeature({ emailRateLimits })` overrides it (`[]` disables). The admin notice mail now carries its `locale` (`en` or `de`) in the notify call.

<!-- kumiko-changes
feature: framework
type: improvement
title: 429 bodies omit the payload bucket digest
-->

<!-- kumiko-changes
feature: waitlist
type: improvement
title: Waitlist submit is limited per email address
-->
