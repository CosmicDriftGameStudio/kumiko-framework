# Secrets Demo

Tenant-owned secrets with envelope encryption, DEK cache, and KEK rotation.

## What it shows

- `r.secret` + `ctx.secrets.get` (audited reads)
- Charge-style handler that never returns the plaintext key

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/secrets-demo
bun test
```
