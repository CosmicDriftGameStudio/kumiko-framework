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
| `pollLimitPerRun` | 50        | Letters asked at the provider per tenant and poll run                                       |

## Environment

| Variable          | Effect                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `LETTER_LIVE`     | `true` sends real letters. The boot refuses it unless `NODE_ENV=production`                      |
| `LETTER_PROVIDER` | Name of the provider used for live sending, for example `letterxpress`. Required with the switch |

Without `LETTER_LIVE=true` every letter goes to the inmemory provider, also in production. A provider's
own test mode is not reachable through this feature. To try one, build the provider directly with
`live: false`.

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

Read `selectLetterProvider(ctx.registry).plugin.capabilities` (`shippingModes`, `envelopes`, `maxSheets`,
`maxBytes`, `maxFlatSheets`, `cancelWindowSeconds`) and offer only what the provider can do. `maxFlatSheets` is the sheet count up to which the provider honors a `flat` envelope; the preview sets `envelopeLeftToProvider` for a `flat` letter above it, because the provider then picks the envelope.

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
  letter. The poll job looks the letter up by its reference. If the provider has no such lookup, a
  privileged user closes the case with `resolve-unknown` after checking the provider's own site. The
  letter is never sent a second time on its own.
- The poll job runs every five minutes per tenant. It compares the address the provider read from the
  PDF with the expected one. A mismatch inside the cancel window cancels the letter and fails it with
  `address-mismatch`; later it only sets `addressMismatch` on the letter.
- A sent letter is polled for 14 more days for the tracking number and a return.
- The poll restarts a handover that stayed in `approved` after the submit job ran out of retries, once the hold time plus 30 minutes have passed.

## Limits to know

- The poll spends about one provider request per open letter, at most `pollLimitPerRun` per tenant and
  run. Many tenants polling at once can exceed a provider's rate limit; the next run catches up.
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

Set the limit through the config feature with the key `LETTER_MONTHLY_COST_LIMIT_CONFIG`. The recipe
`samples/recipes/letter-foundation` shows the whole stack.

## Writing a provider

A provider is a feature that registers a `LetterProviderPlugin` on the `letterProvider` extension:
`capabilities` plus `build(ctx)`, which returns `quote`, `submit`, `status` and optionally `cancel`,
`findByReference` and `findByJobId`. `submit` returns `accepted` or `rejected`; a timeout or an unexpected
answer is thrown, which moves the letter to `submission-unknown`. Call the provider only through
`ctx.egress`. `letter-provider-letterxpress` is the reference, `letter-provider-inmemory` the simulator
for tests (`letterSimulator.setScenario`).
