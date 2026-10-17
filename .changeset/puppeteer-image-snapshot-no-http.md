---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Correct the release note on image-snapshot requests

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: breaking
title: image-snapshot HTML must embed every resource as a data URI
detail: An earlier release note said image-snapshot requests were unchanged. Since the puppeteer-service egress guard, the service fetches no http(s) resources for any request kind, so external img, link and font references in an image-snapshot are dropped without an error.
migration: Embed images, fonts and stylesheets in image-snapshot HTML as data: URIs before sending payload.content.
-->
