# signature

Signature requests: a signed-in user asks several people to sign one PDF of the tenant. Each
signer draws a signature on a display in person or through a link. The last signature
moves the request to `all-signed`; a job appends a signature page to the unchanged original and
completes it. Level `simple` only: a drawn image plus the audit values, not a qualified signature.

## Setup

```typescript
import { createSignatureFeature } from "@cosmicdrift/kumiko-bundled-features/signature";
import { renderHtmlToPdf } from "@cosmicdrift/kumiko-renderer-puppeteer-client";

createSignatureFeature({
  retention: { keepFor: "10y" },
  linkSecret: process.env.SIGNATURE_LINK_SECRET,
  renderHtmlToPdf,
});
```

`bundled-features` never imports the print client; the app injects `renderHtmlToPdf`. Requires
the `files` feature. Order of signatures is free.

## Options

| Option             | Default                                      | Effect                                                                                                                                                                    |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retention`        | required                                     | `{ keepFor }`, counted from creation, hard delete                                                                                                                         |
| `renderHtmlToPdf`  | required                                     | Renders the signature page; an outage leaves `all-signed`, the job retries                                                                                                |
| `linkSecret`       | required                                     | HMAC secret of the links; empty rejects every link                                                                                                                        |
| `deliverLink`      | required                                     | `(ctx, delivery)`: sends the link to the signer (mail) inside `issue-link`'s transaction; `delivery.issuedBy` is the issuing user. The token is never in a handler result |
| `signaturePageUrl` | required                                     | URL of the app's signature page; the token is appended as `#<token>`                                                                                                      |
| `access`           | `{ roles: ["TenantAdmin", "TenantMember"] }` | `AccessRule` of the signed-in handlers, queries, screens and nav; set it when the app hands out other roles. Link handlers stay anonymous                                 |

## Handlers

Signed in: `request`, `sign-in-person`, `issue-link`, `revoke-link`, `cancel`.
Anonymous (rate limited): `open-by-link`, `sign-by-link`, `decline-by-link`. Signing is never an
agent tool. `request`, `issue-link` and `cancel` are agent tools with `risk: "mid"`.

## Links

`issue-link` hands the link (`https://app/sign#<token>`) to `deliverLink`, which must not store it where other users or the assistant read it, and returns only `{ signerId, linkSentAt }`; an older link of the
same signer stops working. A link lives 14 days, opens at most 20 times (`open-by-link` does not consume it)
and dies with the first signature or refusal. Forged, expired, revoked, used up and already signed links
all get the same 422. Of two simultaneous `sign-by-link` calls exactly one wins.

## Events

`signature:event:completed`, `signature:event:declined`, `signature:event:expired`, each with
request id, subject type and id (and the file id or signer id). A cron job (`signature:job:sweep`, every
5 minutes, per tenant) expires requests, completes `all-signed` ones and re-checks races.

## Client

- `/signature/web`: `SignaturePad`, a React wrapper of the core pad; keyboard users get a visible
  "sign on paper" exit through `onSignOnPaper`.
- `/signature/static-sign`: no React, no DOM at import; `takeSignatureToken`, `openSignatureLink`,
  `signByLink`, `declineByLink` and the framework-free `createSignaturePad(canvas)`.
