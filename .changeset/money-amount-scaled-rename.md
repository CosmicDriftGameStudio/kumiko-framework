---
"@cosmicdrift/kumiko-framework": minor
---

`rehydrateMoney`'s Read-form gains `amountScaled` — the exact integer value in `MINOR_UNIT_SCALE` units, replacing the misleadingly-named `amountMinor` (which implied ISO-4217 minor units/cents, but is actually `amount × MINOR_UNIT_SCALE` with a hardcoded 100 for every currency, including zero-decimal ones like JPY). `amountMinor` stays as a `@deprecated` alias with the same value until the renderer-side consumers (`renderer-web/primitives/index.tsx`, `renderer/components/render-field.tsx`) migrate off it in a follow-up.
