---
"@cosmicdrift/kumiko-testing": minor
---

The e2e seed route returns the plain-text part of captured mails

`CapturedMail` in the seed contract has an optional `text`, filled from the mail's text part, so e2e flows can assert on it.

<!-- kumiko-changes
feature: testing
type: improvement
title: CapturedMail.text in the e2e seed route carries the mail's plain-text part
-->
