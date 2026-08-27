# E2E generator

Generate Playwright E2E specs from the registry.

## What it shows

- `generateE2ESpec` (+ `withBootValidatorFixture` in the test) → JSON specs for an external Playwright worker
- The four test kinds and field-type → interaction mapping

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/e2e-generator
bun test
```
