---
"@cosmicdrift/kumiko-bundled-features": patch
---

New bundled feature `letter-provider-letterxpress`, the first real provider for `letter-foundation`.

<!-- kumiko-changes
feature: letter-provider-letterxpress
type: improvement
title: `letter-provider-letterxpress`: LetterXpress as a provider for `letter-foundation`
detail: Standard letters and registered mail (`einwurf`, `uebergabe`) within Germany through the LetterXpress API v3, folded or unfolded in a C4 envelope. LetterXpress honors C4 up to 8 sheets and chooses the envelope itself above that, which the preview reports as `envelopeLeftToProvider`. No return receipt (`rueckschein`). Needs the system config keys `username` and `api-key`. The provider runs only when the `letter-foundation` system config key `live` is on; without the live switch `letter-foundation` never calls LetterXpress. A throttled handover (HTTP 429) waits up to a minute, is repeated once and then rejected, because nothing was created.
-->
