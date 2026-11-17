# signature

Signature requests: a signed-in user asks several people to sign one PDF of the tenant. Each
signer draws a signature on a display in person or through a link. The last signature
moves the request to `all-signed`; a job appends a signature page to the unchanged original and
completes it. Level `simple` only: a drawn image plus the audit values, not a qualified signature.

## Setup

```typescript
import { createSignatureFeature } from "@cosmicdrift/kumiko-bundled-features/signature";

createSignatureFeature({
  retention: { keepFor: "10y", unfinishedKeepFor: "90d" },
  hostEntities: ["lease"],
  linkSecret: process.env.SIGNATURE_LINK_SECRET,
});
```

Requires the renderer-puppeteer-client feature; an outage leaves all-signed, the job retries. Also requires
the `files` feature. Order of signatures is free.

## Options

| Option             | Default                                      | Effect                                                                                                                                                                    |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retention`        | required                                     | `{ keepFor, unfinishedKeepFor? }`; keepFor counts from creation, `unfinishedKeepFor` is opt-in, see below                                                                    |
| `hostEntities`     | required                                     | Entity names a request may belong to (`hostType`); registered entities without their own `parentRef`. A user sees a request only while its host row is readable to them   |
| `linkSecret`       | required                                     | HMAC secret of the links; empty rejects every link                                                                                                                        |
| `deliverLink`      | required                                     | `(ctx, delivery)`: sends the link to the signer (mail) inside `issue-link`'s transaction; `delivery.issuedBy` is the issuing user. The token is never in a handler result |
| `signaturePageUrl` | required                                     | URL of the app's signature page; the token is appended as `#<token>`                                                                                                      |
| `access`           | `{ roles: ["TenantAdmin", "TenantMember"] }` | `AccessRule` of the signed-in handlers, queries, screens and nav; set it when the app hands out other roles. Link handlers stay anonymous                                 |

Host gate: every request names a host row, `hostType` (one of `hostEntities`) and `hostId` in the
`request` payload. `signatureRequest` declares a `parentRef` on it, so the list and detail filter in SQL
and the write handlers (`request`, `sign-in-person`, `issue-link`, `revoke-link`, `cancel`) answer 404
like a missing record. Who sees what is decided by `access.read` of the host entity. `signatureSigner:list`
needs exactly one `requestId` eq filter, otherwise 403; a request whose host the user cannot read gives an
empty page. `subjectType`/`subjectId` are a free label, e.g. the purpose of the document. `request` also
refuses a document the caller cannot open through `GET /files/:id`.

## Retention

`keepFor` counts from creation and hard-deletes requests and signers. `unfinishedKeepFor` (optional; without it the job is not registered and nothing is anonymized): the signers of declined, expired, failed or cancelled requests are anonymized this long after the request's last change, by the job `erase-unfinished-signers` (daily). Completed requests keep `keepFor`.

## Handlers

Signed in: `request`, `sign-in-person`, `issue-link`, `revoke-link`, `cancel`.
`forget-signer`: a TenantAdmin or DataProtectionOfficer erases one signer without an account (row, image, record key) and cancels an open or all-signed request. The signer's data is exported through the query `signature-signer:list`.
Anonymous (rate limited): `open-by-link`, `sign-by-link`, `decline-by-link`. Signing is never an
agent tool. `request`, `issue-link` and `cancel` are agent tools with `risk: "mid"`.

## Links

`issue-link` hands the link (`https://app/sign#<token>`) to `deliverLink`, which must not store it where other users or the assistant read it, and returns only `{ signerId, linkSentAt }`; an older link of the
same signer stops working. A link lives 14 days, opens at most 20 times (`open-by-link` does not consume it)
and dies with the first signature or refusal. Forged, expired, revoked, used up and already signed links
all get the same 422. Of two simultaneous `sign-by-link` calls exactly one wins.

## Events

`signature:event:completed`, `signature:event:declined`, `signature:event:expired`, `signature:event:failed`, each with
request id, subject type and id (and the file id, signer id or failure reason). A cron job (`signature:job:sweep`, every
5 minutes, per tenant) expires requests, completes `all-signed` ones (a changed or missing original, a missing signature image or a signature page above the renderer's size limit ends them as `failed`) and re-checks races.

## Client

- `/signature/web`: `SignaturePad`, a React wrapper of the core pad; keyboard users get a visible
  "sign on paper" exit through `onSignOnPaper`.
- `/signature/static-sign`: no React, no DOM at import; `takeSignatureToken`, `openSignatureLink`,
  `signByLink`, `declineByLink` and the framework-free `createSignaturePad(canvas)`.
