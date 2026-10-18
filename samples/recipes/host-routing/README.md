# Host Routing

Tenant per subdomain with one options object for the API and the HTML pages.

## What it shows

- `createHostRoutingFeature(options)`: the Host header is the only source of the
  anonymous tenant; a forged `X-Tenant` header answers `400 tenant_mismatch`.
- `createHostDispatch(options)`: HTML file and CSP per host, a 404 page for
  unknown shops, and `/de/...` redirecting to the unprefixed path.
- The same `hostDispatch` goes into `runProdApp({ hostDispatch })`; the dev
  server takes it through `toDevHostDispatch` from `@cosmicdrift/kumiko-dev-server`.

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/host-routing
bun test
```
