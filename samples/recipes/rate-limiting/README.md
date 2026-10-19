# Rate Limiting

End-to-end rate limiting: L1 global-IP + L2 auth + L3 handler opt-in.

## What it shows

- Handler `rateLimit: { per, limit, windowSeconds }`
- Several buckets on one handler: `rateLimit: [{ per: "user", ... }, { per: "tenant+handler", ... }]`
- How L1/L2 from `buildServer` stack with L3

## Combined buckets

Pass a list to enforce several budgets on one handler, for example a per-caller and a per-tenant cap:

```ts illustration
r.writeHandler({
  // ...
  rateLimit: [
    { per: "user", limit: 2, windowSeconds: 3600 },
    { per: "tenant+handler", limit: 3, windowSeconds: 3600 },
  ],
});
```

Each bucket applies on its own. The check is all-or-nothing: if any bucket is exhausted the call
answers 429 `rate_limited` for that bucket (the one with the longest wait when several are
exhausted) and no bucket is charged. Each `per` may appear once; an empty list fails at boot.
An anonymous handler needs every bucket to be ip-keyed, and `{ disabled: true, reason }`
stays a single declaration.

## Per-payload limits

A public write handler that mails an address typed by the caller is also limited per
address, so rotating IPs does not help against mail flooding. Declare it next to `rateLimit`:

```ts illustration
r.writeHandler({
  // ...
  access: { roles: ["anonymous"] },
  rateLimit: { per: "ip+handler", limit: 5, windowSeconds: 600 },
  additionalRateLimits: [{ per: { payloadField: "email" }, limit: 3, windowSeconds: 86400 }],
});
```

`additionalRateLimits` only complements `rateLimit`: an anonymous handler still needs a real,
ip-keyed `rateLimit` (boot fails otherwise), and `payloadField` must be a top-level string field
of the handler's Zod object schema. The value is trimmed, lowercased and HMAC-hashed into the
bucket key, so Redis never holds the address in plaintext. The check runs after schema
validation and before the handler, identically for matching and non-matching values, and is
skipped for system callers. Exceeding it answers 429 `rate_limited`.

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/rate-limiting
bun test
```
