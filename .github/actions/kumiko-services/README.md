# kumiko-services

Composite action that starts the Kumiko CI services (Postgres, Redis, Meilisearch, RustFS object storage) as digest-pinned containers and exports the connection settings. Images are pulled from the GHCR mirror and fall back to upstream by digest.

```yaml
- uses: ./.github/actions/kumiko-services # in kumiko-framework
  with: { redis: "true", object-storage: "true" }
# other repos:
- uses: CosmicDriftGameStudio/kumiko-framework/.github/actions/kumiko-services@main
- if: always()
  uses: CosmicDriftGameStudio/kumiko-framework/.github/actions/kumiko-services/stop@main
```

| Input | Default | Meaning |
| --- | --- | --- |
| `postgres` | `true` | start Postgres (`kumiko_dev`, `kumiko_test`) |
| `redis`, `meilisearch`, `object-storage` | `false` | start the service |
| `<service>-port` | empty | fixed host port; empty = random |

Outputs: `postgres-port`, `redis-port`, `meilisearch-port`, `object-storage-port`, `database-url`, `test-database-url`, `redis-url`, `meili-url`, `object-storage-endpoint` (empty for services not started).

Exported env (only for started services): `PG_CONTAINER`, `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_CONTAINER`, `REDIS_URL`, `MEILI_CONTAINER`, `MEILI_PORT`, `MEILI_URL`, `MEILI_MASTER_KEY`, `MINIO_CONTAINER`, `MINIO_ENDPOINT`, `MINIO_REGION`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`.

## Pins

`service-images.txt` is the only place images are pinned (tag plus multi-arch index digest, from `docker buildx imagetools inspect <ref>`). Change the line; after merge the workflow "Mirror CI service images" copies it to GHCR.

## Mirror

Images live as public packages at `ghcr.io/cosmicdriftgamestudio/ci-mirror/<key>`. A failed mirror pull (one attempt) warns and falls back to the upstream image by the same digest. One-time step per new package: set its visibility to public in the package settings in the GitHub UI; the mirror workflow's `verify-anonymous-pull` job fails until then.
