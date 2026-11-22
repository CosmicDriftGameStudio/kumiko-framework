# Sample: Letter Foundation

Send letters by post from an app. `letter-foundation` owns approval, pricing, handover to the provider, polling and the monthly cost limit. The app only calls `sendLetter` from its own write handler.

## What you learn here

- `sendLetter(ctx, input)` runs in the caller's transaction and always creates the letter in `awaiting-approval`. Nothing leaves the system before a user with the `LetterApprover` role approves it.
- The idempotency key decides whether a call creates a letter. The same key returns the same letter with `created: false`.
- `schriftform` is rejected unless the caller passes `formRiskAcknowledged: true`.
- The monthly cost limit is 0 until a privileged user sets `monthlyCostLimitCents`. Without it the handover ends in `failed` with reason `monthly-limit`.
- The test drives `letter-provider-inmemory` through `letterSimulator`. Production mounts `letter-provider-letterxpress`; the app code does not change.

## Feature composition

```
config, tenant-lifecycle, files, cap-counter   (required by letter-foundation)
letter-foundation                              (state machine, approval, handover jobs)
letter-provider-inmemory                       (scriptable provider)
statements  <- this sample                     (the app-side caller)
```

## Run the test

Needs the local Postgres and Redis from `docker compose up -d`.

```
bun test --config=bunfig.integration.toml samples/recipes/letter-foundation
```

The stack clock is manual: the test advances it past the handover hold time and past the simulator's delivery time, so it never sleeps.
