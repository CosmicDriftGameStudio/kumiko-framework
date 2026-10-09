---
"@cosmicdrift/kumiko-bundled-features": minor
---

POST /resubscribe requires the undo token from the POST /unsubscribe response

<!-- kumiko-changes
feature: delivery
type: breaking
title: POST /resubscribe requires the undo token from the POST /unsubscribe response
migration: |
  Clients that called the resubscribe route with the unsubscribe token must send the undo token instead: read it from the hidden token field of the page POST /unsubscribe returns (aud kumiko:resubscribe, valid for 1 hour). The unsubscribe token is rejected on /resubscribe with 400, and the undo token is rejected on /unsubscribe.
-->
