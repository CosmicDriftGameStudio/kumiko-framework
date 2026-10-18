# App config

`kumiko.config.ts` is the one place an app names its features, client entries
and ports. `kumiko/schema.ts`, `kumiko agent lint`, `kumiko check` and
`kumiko ports` all read it.

## What it shows

- **`defineAppConfig`** from `@cosmicdrift/kumiko-framework/config` validates the
  config when the file loads: ports in range and unique within the app, client
  entries relative and inside the app.
- **`prodFeatures`** are mounted only in production (provider features such as
  S3 or SMTP). `allAppFeatures(config)` returns `features` plus `prodFeatures`;
  that is the list migrations and agent lint check.
- **`ports`** with `dev`, `e2e` and optional `infra` (`postgres`, `redis`,
  `meilisearch`, `s3`). Keep them number literals: `kumiko ports` reads them
  statically across all apps of a workspace and reports collisions.

## Files

```
kumiko.config.ts                  defineAppConfig with features, prodFeatures, client, ports
src/feature.ts                    two placeholder features
src/__tests__/app-config.test.ts  feature list, port list, validation errors
```

See [`docs/reference/app-skeleton.md`](../../../docs/reference/app-skeleton.md)
for the files around it.
