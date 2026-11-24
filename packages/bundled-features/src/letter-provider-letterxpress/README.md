# letter-provider-letterxpress

Provider for `letter-foundation` that prints and posts letters through the LetterXpress API v3 (`https://api.letterxpress.de/v3`). It registers itself as the provider `letterxpress`.

## Setup

```typescript
import { createLetterFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { createLetterProviderLetterXpressFeature } from "@cosmicdrift/kumiko-bundled-features/letter-provider-letterxpress";

createLetterFoundationFeature();
createLetterProviderLetterXpressFeature();
```

1. Create API access in the LetterXpress customer area (My account, Access data, LXP API).
2. As SystemAdmin, enter the user name and the API key in the settings mask "LetterXpress" (system config keys `username` and `api-key`; the key is stored encrypted in the secrets store). `build` throws a message naming both config keys when one is missing.
3. Switch "Live letter sending" on in `letter-foundation`. Without it, `letter-foundation` never calls LetterXpress: outside production it runs the inmemory provider whatever the switch says, and in production it refuses letters while the switch is off. LetterXpress must be the only mounted provider besides inmemory.

The request field `mode` is `live` when the live switch is on and `test` otherwise. Through `letter-foundation` only the live case is reachable. The test mode of the provider is used in direct calls of `buildLetterXpressProvider` with `live: false`.

All calls go through `egress()` with `allowOrigins: ["https://api.letterxpress.de"]`, so a redirect to another scheme or port is refused.

## Shipping modes and limits

| Mode          | LetterXpress                              |
| ------------- | ----------------------------------------- |
| `standard`    | plain letter                              |
| `einwurf`     | `registered: "r1"` (Einschreiben Einwurf) |
| `uebergabe`   | `registered: "r2"` (Einschreiben)         |
| `rueckschein` | not offered                               |

- National only (`shipping: "national"`).
- At most 190 sheets. The price list of the provider ends there; larger items ship as a parcel. The API documentation names no limit.
- At most 50 MB per PDF (API documentation).
- A4 portrait only. A landscape PDF is answered with HTTP 500 and creates no order.
- Envelope `flat` (unfolded A4) sends `c4: 1` for letters up to 8 sheets. The API takes the option only below 9 sheets, so for a larger letter it is left out and the provider picks the envelope. The capability `maxFlatSheets` is 8, and the preview sets `envelopeLeftToProvider` for a `flat` letter above it.
- The order carries the letter id in `notice` and `letter-<id>.pdf` as file name.

## Prices

`quote` calls the price endpoint with the page count. The answer is gross in euros. The provider converts it to cents and divides by 1.19 to get the net price, rounded to the cent. The price counts sheets: a duplex letter with 3 and with 4 pages costs the same.

`submit` reads the net amount and the VAT of the accepted order from the answer. The recognized address zone comes back as one text, lines joined by ", ", sender line included.

## Cancel

`cancel` deletes the order. LetterXpress allows this within 15 minutes after transmission and not for orders with status `done`. After a refused delete the provider reads the order: status `done` gives `already_processed`, anything else `window_closed`. An unknown id gives `unknown_job`. Rejected credentials throw, because they say nothing about the order.

## Lookup by reference

The provider has no idempotency key. `findByReference` lists orders and matches `notice`. The list has no search parameter, so it reads at most four pages of 50 orders per filter, newest first (`queue`, `hold`, `done` in live mode; `draft` in test mode). One lookup can therefore cost 12 requests. The capability `lookupRequestsPerLetter` says so, and the poll of `letter-foundation` looks up fewer unknown handovers per run. Found orders carry no cancel deadline because `created_at` has no time zone.

## Failure handling

- HTTP 400, 401, 403, 405 on `submit`: `rejected` with `refused-by-provider`. For 401 and 403 the message says the credentials were rejected.
- HTTP 429 on `submit`: no order was created. The provider waits once, for the time in `Retry-After` (at most one minute, one minute without the header, because the provider limits per minute), and sends again. A second 429 ends as `rejected` with a message that the provider throttles and nothing was created. Other calls are not repeated.
- HTTP 5xx, timeout, network error or an unreadable answer on `submit`: throws, and `letter-foundation` resolves the outcome through `findByReference`.
- Timeouts: 30 seconds, 120 seconds for `submit`.
- Messages and errors never contain the request body, the user name or the key.
- The provider has no rate limiter. LetterXpress allows 120 requests per minute.

## What was observed and what is from the documentation

Observed in the test mode on 2026-11-22 (recorded answers in `__tests__/fixtures/`):

- Order status `draft` and item status `hold`, no tracking code, tracking status `--`, no balance deduction.
- Price, submit, get, list, delete and the answers for a wrong key (401), an unknown id (404) and a landscape PDF (500).
- Deleting an order makes the following GET answer 404.
- Reads work as `POST` with the header `X-HTTP-Method-Override: GET`, because `fetch` refuses a body on GET.
- One run of the finished provider: price, quote, submit, status, lookup by reference, cancel, status again (`not-found`), second cancel (`unknown_job`).
- The C4 option in the price and in an order: two sheets cost 0,91 net folded and 1,76 net flat, eight sheets 1,64 and 2,24. Nine sheets without the option cost 2,29.

Taken from the API documentation only (`__tests__/fixtures/from-docs/`):

- Order status `queue`, `done` and `canceled`, and the tracking number with its status text.
- The 15 minute delete window and the 120 requests per minute.
- `r2` as registered mail with hand-over is an assumption. The documentation calls it Einschreiben.

Not known:

- How an empty balance shows. `insufficient-balance` is never returned.
- Which envelope a letter above 8 sheets ships in.
- How a refused delete looks after the 15 minutes, and how the live mode differs from the test mode beyond the order status.
