# Feature Toggles

Runtime global feature toggles without reboot.

## What it shows

- Dispatcher gate → `feature_disabled` when a feature is off
- Cross-feature hooks skipped when a dependency toggle is off

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/feature-toggles
bun test
```
