---
status: reference
verified: 2026-11-22
evidence: "packages/bundled-features/src/letter-foundation/constants.ts, send-letter.ts, provider-resolver.ts, env-schema.ts, accept-letter.ts, letter-usage.ts, handlers/approve.write.ts, handlers/cancel.write.ts, handlers/resolve-unknown.write.ts, handlers/preview.query.ts, jobs/submit-letter.job.ts, jobs/poll-letters.job.ts; packages/bundled-features/src/letter-provider-letterxpress/README.md; samples/recipes/letter-foundation"
---

# Letters: sending PDFs by post

`createLetterFoundationFeature()` lets an app send a PDF as a postal letter. A print provider prints it,
puts it in an envelope and posts it. This guide covers what an app developer builds, what an operator
sets up before the first real letter, and what to do when a letter gets stuck.

The API reference is the [feature README](../../packages/bundled-features/src/letter-foundation/README.md).
A tested example is [`samples/recipes/letter-foundation`](../../samples/recipes/letter-foundation/).

## How a letter travels

1. The app calls `sendLetter` with file refs, an address, the shipping mode and the envelope. The letter
   is stored in `awaiting-approval`. Nothing has left the system.
2. A user with the role `LetterApprover` opens the price preview and approves. The PDFs are merged, checked
   against the provider's limits, and the price is fixed.
3. Five minutes later a job hands the letter to the provider. Until then `cancel` costs nothing.
4. The provider accepts (`accepted`) or rejects (`failed`). Acceptance books the cost and the counters.
5. A poll job asks the provider every five minutes until the letter is `sent`, and for 14 days after that
   for a tracking number or a return.

No job and no assistant can create an approved letter. Approval is a separate write with its own role,
and the assistant asks the user before every call.

## For app developers

### Offer only what the provider can do

Shipping modes and envelopes differ between providers. Read the capabilities and build the dialog from
them:

```ts illustration
const { capabilities } = selectLetterProvider(ctx.registry).plugin;
// capabilities.shippingModes, capabilities.envelopes, capabilities.maxSheets
```

`sendLetter` refuses a mode or envelope the provider lacks, so a stale dialog fails early and with a
readable reason.

### Envelope

`folded` is the usual letter. `flat` sends unfolded A4 sheets in a C4 envelope, for contracts and other
documents that should arrive without a fold. Providers charge more for it and may limit it to a number
of sheets. The preview shows the real price for the chosen envelope. A provider may honor `flat` only up to a sheet count (`capabilities.maxFlatSheets`); above it the provider picks the envelope, and the preview says so with `envelopeLeftToProvider: true`. Nothing is refused, so show the hint before approval.

### Form requirements

Every letter states what the law asks of the document: `formfrei`, `textform` or `schriftform`. A
printed letter has no handwritten signature and cannot meet the written form. The feature therefore
refuses `schriftform` unless the app sends `formRiskAcknowledged: true`.

The app decides how to ask. A workable pattern: show the warning in the send dialog, require a tick,
and pass the flag only then. The value is stored on the letter and returned by the preview, so the
approver sees the same warning before releasing the letter.

### Delivery is not a state

The provider reports that it posted the letter. It does not report that the letter arrived. If the app
tracks deadlines that start with receipt, it has to set its own assumption after `sent` and let the user
correct it. `latestReceiptDate` is stored on the letter for such a warning; the feature does not act on
it.

### One letter per recipient

Build the `idempotencyKey` from the business record and the recipient. A second click, a retry or a
replayed job then returns the existing letter instead of printing a second one.

The key also returns a letter that has failed or was canceled. To send again after such a letter, add
an attempt number to the key, for example the count of this recipient's letters that ended in `failed`,
`canceled` or `returned`.

### Letters of one business record

Pass `source: { entityType, entityId }` to `sendLetter`. The `list` query filters by `sourceEntityType`
and `sourceEntityId`, which is enough for a "letters" section on the record that shows each letter and
its state.

## For operators

### Before the first real letter

| Step | Why |
| ---- | --- |
| Open an account with the provider and load credit | The account belongs to the operator and serves all tenants |
| Sign the data processing agreement with the provider | The provider reads names, addresses and the document |
| Set the provider's credentials as secrets | See the provider's README for the variable names |
| Set `LETTER_PROVIDER` and `LETTER_LIVE=true` in production | Production needs an explicit `LETTER_LIVE`. `false` keeps the simulator; without the variable no letter can be previewed, approved or handed over |
| Set `monthlyCostLimitCents` for each tenant that may send | The limit is 0 by default, so a tenant sends nothing until it is set |
| Give the role `LetterApprover` to the users who may release letters | `TenantAdmin` does not include it. The app declares the role with `EXT_ASSIGNABLE_ROLE`, otherwise the members screen does not offer it |

`LETTER_LIVE=true` boots only with `NODE_ENV=production`. A staging or development system therefore
cannot send a real letter, whatever else is configured. Outside production a missing `LETTER_LIVE`
means the simulator.

A production system without `LETTER_LIVE`, or with `LETTER_LIVE=true` and no known `LETTER_PROVIDER`,
still boots. Users get the error `letter_provider_not_configured` in the preview and on approval, and
letters approved before stay in `approved`. Once the variable is set, the poll job asks for their
handover again, at the earliest 30 minutes plus the hold time after the approval.

### The monthly cost limit

The limit is a net amount in cents per tenant and calendar month. The handover reserves the previewed
price against it; a letter that does not fit fails with the reason `monthly-limit` and is not sent. The
cap counters `letter.cost-net-cents`, `letter.<mode>.count`, `letter.<mode>.sheets` and `letter.pages`
hold what was actually sent and are the basis for billing a tenant.

The provider's credit is a second, shared limit. When it runs out, the provider rejects letters of every
tenant. Watch the credit on the provider's side; the framework does not read it.

### When a letter is stuck

| State | Meaning | What to do |
| ----- | ------- | ---------- |
| `approved` for more than half an hour | The submit job ran out of retries, for example because the provider's credentials or `LETTER_LIVE` are missing | Fix the cause. The poll job asks the submit job to hand the letter over again once the hold time plus 30 minutes have passed |
| `submission-unknown` | The handover timed out or never finished. The provider may or may not have the letter | Wait for the poll job, which looks the letter up by its reference. If the provider reports a rejection, the letter fails and its estimate is given back. If the provider offers no lookup, check the provider's site: if it has the order, pass its id as `providerJobId` to `resolve-unknown` and the letter is accepted at the order's price; if not, close the case with `resolve-unknown` and a note |
| `on-hold` | The provider stopped the letter and waits for the operator | Look up the reason at the provider and fix it there. The poll job picks up the change |
| `failed` with `address-mismatch` | The provider read a different address from the PDF than the app expected, and the letter was canceled in time | Fix the address block of the template and send again |
| `addressMismatch` set on a sent letter | The same mismatch, found after the cancel window closed | Check the letter by hand; it was posted |
| `failed` with `monthly-limit` | The tenant's limit does not cover the letter | Raise the limit or wait for the next month, then send again |

A letter in `submission-unknown` is never sent a second time on its own. Its estimate stays booked
against the month, because the letter may be at the provider and a reservation would expire after an
hour. `resolve-unknown` without `providerJobId` marks it failed and gives the estimate back, so use it
only after checking that the provider has no such order. With `providerJobId` the order is fetched by
id, must carry this letter's reference, and the letter is accepted at the order's price.

The poll job never hands a letter over itself. For a letter stuck in `approved` it writes the event
`handover-restart-requested`, and the submit job, which handles one letter at a time, does the handover.
That run takes a fresh reservation in the current month, so a limit lowered since the approval fails the
letter with `monthly-limit`.

### Limits to know

- The poll job spends at most 50 provider requests per tenant and run (`pollLimitPerRun`) and stops
  touching further letters after four minutes. A status check costs one request; looking up an unknown
  handover can cost more (12 with LetterXpress), so only a few of those fit into a run. With many tenants
  the shared account can still hit the provider's rate limit. Nothing is lost; the next run catches up.
- The submit job hands over one letter at a time across all tenants. A provider that takes long to
  answer delays the letters behind it.
- A provider's own test mode is not reachable through the feature. Outside live sending the simulator
  runs. To exercise a provider's test mode, build the provider directly with `live: false`.
- Letters and their merged PDFs are kept for seven years and then deleted. Destroying a tenant archives
  and deletes them.
