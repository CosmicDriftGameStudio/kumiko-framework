# Auth Claims

Features inject identity facts into the JWT.

## What it shows

- `r.authClaims(fn)` contributing to `SessionUser.claims`
- Claims recomputed on login and tenant switch

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/auth-claims
bun test
```
