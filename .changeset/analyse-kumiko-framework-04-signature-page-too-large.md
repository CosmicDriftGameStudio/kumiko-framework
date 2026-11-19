---
"@cosmicdrift/kumiko-bundled-features": patch
---

An all-signed request whose signature page exceeds the renderer's size limit now ends as `failed` instead of retrying every five minutes.

<!-- kumiko-changes
feature: signature
type: fix
title: Oversized signature pages end the request as failed
detail: The signature page embeds every signer's image, so many large signatures can exceed the PDF service's HTML limit. The sweep retried such a request every five minutes forever. When the renderer answers `payload_too_large`, the request now ends in `failed` with the event `signature:event:failed` and the reason `signature-page-too-large`. Renderer outages and other errors still retry on the next run.
-->
