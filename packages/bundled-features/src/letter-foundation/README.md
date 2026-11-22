# letter-foundation

Sends PDFs of a tenant as postal letters through a print provider. The app calls `sendLetter` with file
refs and an address. The letter then waits for a person to approve it, is handed to the provider by a
job and followed until the provider reports it sent, failed or returned.

The provider account belongs to the operator and is shared by all tenants. A monthly cost limit per
tenant decides how much of it a tenant may spend.

## Setup

```typescript
import { createLetterFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { createLetterProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/letter-provider-inmemory";
import { createLetterProviderLetterXpressFeature } from "@cosmicdrift/kumiko-bundled-features/letter-provider-letterxpress";

createLetterFoundationFeature();
createLetterProviderInMemoryFeature();
createLetterProviderLetterXpressFeature();
```

Requires `config`, `files`, `cap-counter` and `tenant-lifecycle`. Register the inmemory provider in every
app: it is what runs whenever live sending is off.

| Option            | Default   | Effect                                                                                      |
| ----------------- | --------- | ------------------------------------------------------------------------------------------- |
| `handoverHoldMs`  | 5 minutes | Wait between approval and handover, so a letter can be canceled without asking the provider |
| `pollLimitPerRun` | 50        | Provider requests the poll may spend per tenant and run                                     |

## Environment

| Variable          | Effect                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `LETTER_LIVE`     | `true` sends real letters, `false` simulates. The boot refuses `true` unless `NODE_ENV=production` |
| `LETTER_PROVIDER` | Name of the provider used for live sending, for example `letterxpress`. Required with `true`       |

Outside production a missing `LETTER_LIVE` means the inmemory provider. In production the variable must
be `true` or `false`. If it is missing there, the app still boots, but preview, `sendLetter`, `approve`
and `cancel` answer 422 `letter_provider_not_configured`, and approved letters stay in `approved` until
the variable is set. The same error covers `LETTER_LIVE=true` without a known `LETTER_PROVIDER`.

A provider's own test mode is not reachable through this feature. To try one, build the provider
directly with `live: false`.

## Sending a letter

```typescript
import { sendLetter } from "@cosmicdrift/kumiko-bundled-features/letter-foundation";

const result = await sendLetter(ctx, {
  fileRefIds: [statementFileId],
  expectedRecipient: { name, street, houseNumber, postalCode, city },
  shippingMode: "standard",
  envelope: "folded",
  color: false,
  duplex: true,
  formRequirement: "formfrei",
  idempotencyKey: `statement:${statementId}:${contactId}`,
  source: { entityType: "statement", entityId: statementId },
});
```

`sendLetter` runs in the caller's transaction and always creates a letter in `awaiting-approval`. The
same `idempotencyKey` returns the same letter with `created: false`. Several `fileRefIds` are merged
into one PDF in the given order when the letter is approved.

| Field                  | Meaning                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `shippingMode`         | `standard`, `einwurf`, `uebergabe` or `rueckschein`. A mode the provider lacks is refused                     |
| `envelope`             | `folded` (default) or `flat`, an unfolded A4 sheet in a C4 envelope. Refused if the provider lacks it         |
| `formRequirement`      | What the law asks of this document: `schriftform`, `textform` or `formfrei`                                   |
| `formRiskAcknowledged` | Only for `schriftform`, see below                                                                             |
| `latestReceiptDate`    | The day the letter must have arrived, for the app's own warning. The feature stores it and does not act on it |
| `costCenterRef`        | Free reference for the app's cost reports                                                                     |

Read the provider's `capabilities` (`shippingModes`, `envelopes`, `maxSheets`, `maxBytes`,
`maxFlatSheets`, `cancelWindowSeconds`) and offer only what the provider can do.
`selectLetterProviderOrFailure(ctx.registry)` returns them as `data.plugin.capabilities`, or the failure
`letter_provider_not_configured` when the environment names no usable provider; `selectLetterProvider`
throws in that case. `maxFlatSheets` is the sheet count up to which the provider honors a `flat`
envelope; the preview sets `envelopeLeftToProvider` for a `flat` letter above it, because the provider
then picks the envelope.

### Written form

A printed letter carries no handwritten signature, so it never meets the written form. `sendLetter`
refuses `formRequirement: "schriftform"` with `letter_schriftform_not_possible` unless the app passes
`formRiskAcknowledged: true`. Set it only after the user was told and chose to send anyway. The letter
stores the value, and the preview returns it so the approver sees the warning again.

## Approval, price and limit

A user with the role `LetterApprover` approves each letter. `TenantAdmin` does not include it, because
sending costs money. The app makes the role assignable in the members screen:

```typescript
r.applyExtension({ name: EXT_ASSIGNABLE_ROLE, entity: LETTER_ROLES.approver });
```

The query `preview` returns the unit price, pages, sheets, the envelope, the form
fields and whether the tenant's monthly limit covers the letter. `approve` merges the PDF, checks it
against the provider's limits and fixes the price. It is an agent tool with `effect: "outbound"`, so the
assistant asks before every call.

The config key `monthlyCostLimitCents` holds the limit per tenant in net cents. It is 0 until a
privileged user sets it, so a new tenant sends nothing. The handover reserves the quoted price against
the limit; a letter that does not fit fails with `monthly-limit`.

Usage is counted in `cap-counter` when the provider accepts the letter, with the price the provider
charged:

| Counter                 | Counts                    |
| ----------------------- | ------------------------- |
| `letter.<mode>.count`   | Letters per shipping mode |
| `letter.<mode>.sheets`  | Sheets per shipping mode  |
| `letter.pages`          | Pages                     |
| `letter.cost-net-cents` | Net cost in cents         |

A letter that fails or is canceled before it was sent is booked back.

## States

`awaiting-approval` → `approved` → `submitting` → `accepted` → `sent`, with `on-hold`, `failed`,
`canceled`, `returned` and `submission-unknown` beside it. `LETTER_TRANSITIONS` lists every allowed step
and each step writes an event (`LetterEvents`). There is no state "delivered": the provider reports that
it posted the letter, never that it arrived.

- `cancel` works without the provider until the handover starts. After acceptance it asks the provider,
  which may refuse (`window_closed`, `already_processed`, `unknown_job`).
- `submission-unknown` means the handover timed out and nobody knows whether the provider has the
  letter. The quoted price stays booked against the limit meanwhile. The poll job looks the letter up by
  its reference: a hit accepts it with the real price, a rejection fails it and books the estimate back.
  If the provider has no such lookup, a privileged user closes the case with `resolve-unknown` after
  checking the provider's own site. The letter is never sent a second time on its own.
- A handover that stays in `submitting` for ten minutes is treated the same way: the poll moves it to
  `submission-unknown`.
- The poll job runs every five minutes per tenant. It compares the address the provider read from the
  PDF with the expected one. A mismatch inside the cancel window cancels the letter and fails it with
  `address-mismatch`; later it only sets `addressMismatch` on the letter.
- A sent letter is polled for 14 more days for the tracking number and a return.
- A letter can stay in `approved` when the submit job ran out of retries. Once the hold time plus 30
  minutes have passed, the poll writes the event `handover-restart-requested` and the submit job hands
  the letter over. The poll never calls the provider's `submit` itself, so two runs cannot hand over the
  same letter. The retry takes a fresh reservation in the current month; a limit lowered meanwhile fails
  the letter with `monthly-limit`.

## Limits to know

- The poll spends at most `pollLimitPerRun` provider requests per tenant and run and stops touching
  further letters after four minutes. A status check costs one request. Looking up an unknown handover
  costs `capabilities.lookupRequestsPerLetter` requests, so fewer of those fit into a run. Many tenants
  polling at once can still exceed a provider's rate limit; the next run catches up.
- The submit job hands over one letter at a time across all tenants.
- Letters and their merged PDFs are kept seven years and then deleted. Destroying a tenant archives and
  deletes them with the tenant.
- The recipient address is personal data. Events carry only the letter id and the previous state.
- The data export of a user lists the letters the user created or approved, with their state and source
  and without the recipient. Deleting a user keeps the letters; they hold only the user id.
- `list` filters by `status`, `sourceEntityType` and `sourceEntityId`, so an app can show the letters of
  one business record.

## Testing an app that sends letters

Mount `letter-provider-inmemory` and steer it with `letterSimulator` (`setScenario`, `setClock`, `reset`).
Two things differ from production timing:

- The handover job is queued with a real delay. Pass `createLetterFoundationFeature({ handoverHoldMs: 300 })`
  in the test stack, otherwise `drainJobs` waits the full five minutes.
- The simulator reports a letter as sent once its cancel window of ten minutes has closed. Advance the
  test clock by eleven minutes and run the poll job before expecting `sent`.

The simulator keeps the reference and the spec of each order. It keeps the PDF bytes only after
`letterSimulator.setKeepDocuments(true)`. The scenario field `lookupRejection` makes `findByReference`
report a rejection, which is how a test reaches the failed end of an unknown handover.

Set the limit through the config feature with the key `LETTER_MONTHLY_COST_LIMIT_CONFIG`. The recipe
`samples/recipes/letter-foundation` shows the whole stack.

## Writing a provider

A provider is a feature that registers a `LetterProviderPlugin` on the `letterProvider` extension:
`capabilities` plus `build(ctx)`, which returns `quote`, `submit`, `status` and optionally `cancel`,
`findByReference` and `findByJobId`. `submit` returns `accepted` or `rejected`; a timeout or an unexpected
answer is thrown, which moves the letter to `submission-unknown`. Set `lookupRequestsPerLetter` in the
capabilities when `findByReference` needs more than one request per letter. Call the provider only through
`ctx.egress`. `letter-provider-letterxpress` is the reference, `letter-provider-inmemory` the simulator
for tests (`letterSimulator.setScenario`).
