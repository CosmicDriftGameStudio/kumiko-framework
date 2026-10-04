---
status: reference
verified: 2026-10-04
evidence: "kumiko-framework#3468 (consent gate, consent and cancel dialogs, termination handlers, § 312k pages), #3493 (platform termination scope), #3515 (layout around termination pages); packages/bundled-features/src/billing-foundation/{consumer-protection,web}; samples/apps/use-all-bundled/e2e-billing-gallery"
---

# Billing consumer protection: consent, cancel and termination

`createBillingFoundationFeature` has an optional `consumerProtection` option for apps that sell to consumers in the EU. It adds a recorded consent before checkout, a contract confirmation mail, a cancel dialog for logged-in admins and public termination pages. Without the option none of this exists and billing behaves as before. The option requires `baseUrl` and the features `template-resolver`, `delivery`, `user` and `tenant`.

## Options

`ConsumerProtectionOptions`:

- `termsTextBlock`: slug of a `text-block` in `template-resolver`. It is read from the system tenant, so a tenant cannot shadow it. Its content hash is stored with every consent.
- `vatNote`: per-locale VAT note, at least `de` and `en`.
- `operatorEmail`: receives notices for withdrawals and extraordinary terminations.
- `legalLinks`: `{ terms, withdrawal, privacy }` for all locales, or one such set per locale (`de` and `en` both required). Values are root-relative paths or absolute https URLs.
- `terminationScope`: `"tenant-host"` (default) or `"platform"`. See below.
- `oneOffItemLabel(ctx, priceId)`: names the item of a one-off payment for the consent record and the confirmation mail. The key resolves through the registry i18n, so qualify it with the registering feature.

Locales other than `de` and `en` resolve to English.

## Consent before checkout

`start-plan-checkout` and `create-checkout-session` require a `consent` payload (`earlyPerformanceRequested`, `withdrawalLossAcknowledged`, `consentTextVersion`, `locale`) and reject unknown fields. The gate runs after the provider, price and subscription checks and before the provider call:

- A missing consent, or a flag that is not `true`, returns 422 `consent_required`.
- A `consentTextVersion` that is not current for the locale returns 422 `consent_text_outdated`. The client should reload the plans query to get the new texts.
- A terms block that cannot be resolved returns 422 `terms_unavailable`.

After the provider accepted the checkout, the handler appends `checkout-consent-recorded` with the price, the text version, the terms hash and template version, the locale and the acting user. When a later subscription or payment event with the same `consentId` shows the contract is live, a job sends the contract confirmation mail once.

## `BillingPlansPanel` dialogs

`BillingPlansPanel` from `@cosmicdrift/kumiko-bundled-features/billing-foundation/web` shows both dialogs itself when `billing-plans` returns `consumerProtection`. An app mounts the panel and gets them.

- `CheckoutConsentDialog` opens when a plan is ordered. It shows the plan, the price, links from `legalLinks` for the UI locale and two checkboxes with the consent texts. The order button stays disabled until both are ticked. On `consent_text_outdated` the dialog calls `onConsentTextOutdated`, which refetches the plans. The dialog, its props type and `CONSENT_TEXT_OUTDATED_CODE` are exported for apps that build their own checkout.
- The cancel-contract dialog opens from a button for users who may manage billing, and is hidden once a cancellation is scheduled. It has three steps: choose withdrawal or termination, choose ordinary or extraordinary (a reason is required for extraordinary), then confirm. The receipt shows the request id, the time received and the effective date.

## Terminating a contract

Two write handlers record a termination, and both end in a receipt mail to the declarant plus an operator notice for withdrawals and extraordinary terminations.

- `terminate-contract` (logged-in admin, same roles as purchase): the dialog's handler. Termination cancels at period end, withdrawal cancels immediately. The receipt goes to the caller's email.
- `request-contract-termination` (anonymous, rate limited): used by the public pages. It finds the contract by the declarant's email and answers every outcome the same, so the response does not show whether the email belongs to a customer. A matched request appends `contract-termination-declared`, and the job `cancel-on-public-termination-declared` then asks the provider for `cancel_at_period_end` and appends `contract-termination-requested`. A public withdrawal makes no provider call. In tests, wait for the job with `drainJobs`.

## Public pages

`createContractTerminationRoutes(options?)` returns the anonymous routes for the German page (`/legal/kuendigen`) and the English page (`/legal/cancel`). The flow is form, review, confirm, without JavaScript. Pass them in `extraRoutes`.

```ts
extraRoutes: [createSubscriptionWebhookRoute(), ...createContractTerminationRoutes()],
```

- `paths` overrides the path per locale.
- `wrapLayout` puts the app layout around every page (form, review, result, 429, error). It gets the HTML body and `alternates`, a locale-to-path map for a language switch built from plain links. The headers stay with the framework: the CSP has `script-src 'none'` and `frame-ancestors 'none'`, so a layout must work without JavaScript. The body sits in `<div data-kumiko-page="contract-termination">` with `data-kumiko-*` hooks.
- The trailing-slash form of each path answers 301 to the configured path for GET and HEAD.
- The confirm POST re-enters `/api/write` and forwards `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Tenant` and the `kumiko_tenant` cookie, so a host-based `tenantResolver` finds the same tenant. The session cookie, `Authorization` and `X-Forwarded-For` are not forwarded.

With `terminationScope: "platform"` the handler also runs on a host that resolves no tenant (a platform apex). It records on the matched tenant's subscription stream.
