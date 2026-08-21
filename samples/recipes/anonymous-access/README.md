# Anonymous Access

Public endpoints without a logged-in user.

## What it shows

- `access: "anonymous"` on handlers that must stay public
- Rate limits that still bind anonymous callers (`per: "ip+handler"`)

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/anonymous-access
bun test
```
