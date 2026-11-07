# Signature

Several people sign one PDF of the tenant, in person on a display or through a link. The last
signature moves the request to `all-signed`; a job renders a signature page, appends it to the
unchanged original and completes the request.

## What it shows

- **Feature** - `createSignatureFeature({ retention, linkSecret, renderHtmlToPdf, deliverLink, signaturePageUrl })`.
  Needs `files` and `user-data-rights` (exports and erases signer data); the test mounts user-data-rights with its own dependencies.
- **deliverLink** - `issue-link` hands the signing link to the app (mail) and returns only
  `{ signerId, linkSentAt }`: whoever may issue a link must not be able to sign with it.
- **renderHtmlToPdf** - injected; in an app it is the client of `@cosmicdrift/kumiko-renderer-puppeteer-client`.
- **Test** - `setupTestStack` and HTTP: request, issue-link, anonymous sign-by-link, sweep job, completed.

## Files

```
src/feature.ts                              the feature with a link outbox and a stand-in printer
src/__tests__/feature.integration.test.ts   request to completed request over HTTP
```
