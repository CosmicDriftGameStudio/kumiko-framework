---
status: reference
verified: 2026-11-24
evidence: "packages/bundled-features/src/letter-foundation/constants.ts, send-letter.ts, provider-resolver.ts, accept-letter.ts, letter-usage.ts, handlers/approve.write.ts, handlers/cancel.write.ts, handlers/resolve-unknown.write.ts, handlers/preview.query.ts, jobs/submit-letter.job.ts, jobs/poll-letters.job.ts; packages/bundled-features/src/letter-provider-letterxpress/README.md; samples/recipes/letter-foundation"
---

# Letters: sending PDFs by post

## In plain words

![Your app hands over PDF and address, a person approves the price, a print service prints and posts the letter, the app shows "sent". Monthly budget per customer; test systems use a simulator.](/diagrams/letters-flow-en.svg)

Some business mail still has to arrive on paper, such as a service charge statement or a rent increase.
With this feature nobody prints, folds or goes to the post office. Every letter costs real money, so
nothing goes out without a person's approval, and the operator sets a monthly budget for every customer
of the app.

## Who does what

| Who | What they do | Where |
| --- | --- | --- |
| App developer | Mounts the letter features and adds "send by post" to a process, for example after a statement was created | Code, see [For app developers](#for-app-developers) |
| Operator (SystemAdmin) | Opens an account with the print service, loads credit, signs the data processing agreement, enters the access data, sets the budget per customer and switches live sending on | Settings › Platform › Letters, see [For operators](#for-operators) |
| Customer's admin | Gives the role "Letter approver" to the people who may release letters | Members screen of the app |
| Approver | Checks address, pages and price, then approves or cancels | The app's letter screens |

## What a letter costs

A letter costs what the print service charges for it: printing, envelope, postage and, if chosen,
registered mail. The preview shows this price before anyone approves. The operator pays the print
service from a prepaid account that serves all customers of the app.

The monthly budget caps what one customer may spend per calendar month. It counts each letter at its
full price, including letters approved but not yet handed over. The operator sets it in Settings ›
Platform › Letters as the default for every customer and can give one customer its own value in
Settings › Tenant › Letters. As long as no budget is set, nothing goes out. When the budget is used up,
the approval of the next letter is refused and the letter keeps waiting; an approver approves it again
in the next month or after the operator raised the budget. What was actually sent is counted per
customer (letters, sheets, pages, net cost), so the operator can bill it on.

## Start in four steps

1. Mount `createLetterFoundationFeature()`, `createLetterProviderLetterXpressFeature()` for production
   and `createLetterProviderInMemoryFeature()` as the simulator.
2. Call `sendLetter` from your own write handler, for example where a statement is finished:

   ```ts illustration
   return sendLetter(ctx, {
     fileRefIds: [fileRefId],
     expectedRecipient: recipient,
     shippingMode: "standard",
     color: false,
     duplex: true,
     formRequirement: "formfrei",
     idempotencyKey: `statement:${statementId}:${recipient.postalCode}:${recipient.street}`,
     source: { entityType: "statement", entityId: statementId },
   });
   ```

3. Show the letters of a record with the `list` query and let an approver open the preview and approve.
4. Try it on a development system. The simulator plays the print service, so you see the whole path
   without a letter being printed.

The API reference is the [feature README](../../packages/bundled-features/src/letter-foundation/README.md).
A tested example is [`samples/recipes/letter-foundation`](../../samples/recipes/letter-foundation/).

## How a letter travels

1. The app calls `sendLetter` with file refs, an address, the shipping mode and the envelope. The letter
   is stored in `awaiting-approval`. Nothing has left the system.
2. A user with the role `LetterApprover` opens the price preview and approves. The PDFs are merged, checked
   against the provider's limits, and the price is fixed. With `duplex` every file starts on a new sheet.
   A letter the tenant's monthly budget does not cover is refused and keeps waiting.
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
const selected = await selectLetterProviderOrFailure(ctx);
if (!selected.isSuccess) return selected;
const { capabilities } = selected.data.plugin;
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
| Enter the provider's credentials in the Platform › Letters mask | SystemAdmin; a section of the mask, the key is stored encrypted. See the provider's README for the fields |
| Switch "Live letter sending" on in production | SystemAdmin. Off, no letter can be previewed, approved or handed over in production; the simulator runs only outside production |
| Set the monthly budget for each tenant that may send | SystemAdmin: Settings › Platform › Letters sets the default for every tenant, Settings › Tenant › Letters a tenant's own value (config key `monthlyCostLimitCents`). It is 0 by default, so nothing goes out until it is set |
| Give the role `LetterApprover` to the users who may release letters | `TenantAdmin` does not include it. The app declares the role with `EXT_ASSIGNABLE_ROLE`, otherwise the members screen does not offer it |

The switch `live` (settings mask "Live letter sending", SystemAdmin) works only with `NODE_ENV=production`.
A staging or development system therefore cannot send a real letter, whatever else is configured: outside
production the simulator runs, whatever the switch says.

A production system with the switch off, or with it on and not exactly one real provider mounted, still
boots. Users get the error `letter_provider_not_configured` in the preview and on approval, and letters
approved before stay in `approved`. Once the switch is on, the poll job asks for their handover again, at
the earliest 30 minutes plus the hold time after the approval. A letter that could not be handed over for
two hours past its hold time fails with `handover-stalled`.
A production system never simulates: to try letters on a staging system, boot it without
`NODE_ENV=production`.

A letter belongs to the provider it was approved with. After a change of the switch or of the mounted
providers the poll leaves the other provider's letters alone, `cancel` and `resolve-unknown` with a `providerJobId`
refuse them with `letter_provider_changed`, and an approved letter that was not handed over fails with
`provider-changed`. Change the provider only when no letter is in `approved`, `submitting`, `accepted`,
`on-hold` or `submission-unknown`. The inmemory provider keeps its orders in the process, so with the
switch off a restart or a second instance loses them and their letters fail with
`not-found-at-provider`.

### The monthly budget

The budget is a net amount per tenant and calendar month, entered in euros in the settings mask and stored in cents. `approve` refuses a letter it does not
cover with `letter_monthly_limit_not_covered`; letters that are approved and not handed over yet count as
used. The handover then reserves the price against the budget. If the budget was lowered after the
approval, the letter fails with the reason `monthly-limit` and is not sent. The
cap counters `letter.cost-net-cents`, `letter.<mode>.count`, `letter.<mode>.sheets` and `letter.pages`
hold what was actually sent and are the basis for billing a tenant.

The provider's credit is a second, shared limit. When it runs out, the provider rejects letters of every
tenant. Watch the credit on the provider's side; the framework does not read it.

### When a letter is stuck

| State | Meaning | What to do |
| ----- | ------- | ---------- |
| `approved` for more than half an hour | The submit job ran out of retries, for example because the provider's credentials are missing or the live switch is off | Fix the cause. The poll job asks the submit job to hand the letter over again once the hold time plus 30 minutes have passed; after two hours past the hold time the letter fails with `handover-stalled` |
| `submission-unknown` | The handover timed out or never finished. The provider may or may not have the letter | Wait for the poll job, which looks the letter up by its reference. If the provider reports a rejection, the letter fails and its estimate is given back. If the provider offers no lookup, check the provider's site: if it has the order, pass its id as `providerJobId` to `resolve-unknown` and the letter is accepted at the order's price; if not, close the case with `resolve-unknown` and a note |
| `on-hold` | The provider stopped the letter and waits for the operator | Look up the reason at the provider and fix it there. The poll job picks up the change |
| `failed` with `address-mismatch` | The provider read a different address from the PDF than the app expected, and the letter was canceled in time | Fix the address block of the template and send again |
| `addressMismatch` set on a sent letter | The same mismatch, found after the cancel window closed | Check the letter by hand; it was posted |
| `approve` answers `letter_monthly_limit_not_covered` | The tenant's budget does not cover the letter together with what was sent and approved this month | Raise the budget or wait for the next month, then approve again |
| `failed` with `monthly-limit` | The budget was lowered between approval and handover | Raise the budget or wait for the next month, then send again |
| `failed` with `handover-stalled` | The letter stayed in `approved` for two hours past its hold time and could not be handed over | Fix the cause, for example the provider credentials, and send the letter again |
| `failed` with `provider-changed` | The provider was switched between approval and handover | Send the letter again under the provider now selected |

A letter in `submission-unknown` is never sent a second time on its own. Its estimate stays booked
against the month, because the letter may be at the provider and a reservation would expire after an
hour. `resolve-unknown` without `providerJobId` marks it failed and gives the estimate back, so use it
only after checking that the provider has no such order. With `providerJobId` the order is fetched by
id, must carry this letter's reference, and the letter is accepted at the order's price.

The poll job never hands a letter over itself. For a letter stuck in `approved` it writes the event
`handover-restart-requested`, and the submit job, which handles one letter at a time, does the handover.
That run takes a fresh reservation in the current month, so a budget lowered since the approval fails the
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
