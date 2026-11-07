---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
---

New `signature` bundled feature: several people sign one PDF, in person on a display or through a link, and the request ends as the original plus a signature page.

<!-- kumiko-changes
feature: signature
type: improvement
title: Signature requests with in-person and link signing
detail: `createSignatureFeature({ retention, linkSecret, renderHtmlToPdf, deliverLink, signaturePageUrl })` adds the entities `signatureRequest` and `signatureSigner`, the handlers `request`, `sign-in-person`, `issue-link` (sends the link through `deliverLink(ctx, { signerId, url, ..., issuedBy })` inside its own transaction, so the app can dispatch its mail write and pick the issuer's mailbox; it never returns the token), `revoke-link`, `cancel` and the anonymous, rate-limited `open-by-link`, `sign-by-link`, `decline-by-link`. Links carry a row-bound grant in the URL fragment (14 days, 20 opens, single-use signing, one answer for every rejection). The last signature sets the request to `all-signed`; the `signature:job:sweep` cron renders the signature page through the injected print function, appends it with pdf-lib and completes the request; the events `completed`, `declined` and `expired` report the outcome. The subpaths `./signature/web` (`SignaturePad`) and `./signature/static-sign` (no React) ship the signature field.
migration: The feature adds the tables `read_signature_requests` and `read_signature_signers`; apps that mount it run the schema pipeline migration.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: renderHtmlToPdf for callers that bring their own HTML
detail: `renderHtmlToPdf(html, options?)` renders an HTML string to PDF through the print service and returns the bytes. It is the function the signature feature takes as `renderHtmlToPdf`.
-->
