---
status: reference
verified: 2026-10-26
evidence: "docs/reference/migration-guide.md sections 0.389.0, 0.390.0 and 0.392.0; packages/feature-ast/src/scripts/codemod (ctx-namespaces); packages/framework/src/db/error-codes, row-level-security-boot-check.ts; packages/framework/package.json (meilisearch peer)"
---

# Upgrading to 0.392: before and after

Releases 0.389 to 0.392 (2026-10-23 to 2026-10-25) changed the Postgres driver, turned row level security on, grouped the handler context into namespaces and shrank the public exports. This page shows each change as code before and after. The full list with every renamed member is in the migration guide (`docs/reference/migration-guide.md` in the framework repo).

Order for an app on 0.388 or older:

1. Bump the framework and run `bun kumiko-upgrade --apply`. It runs the codemods (context namespaces, feature AST imports) and syncs the managed files.
2. Fix what the codemod lists for manual review.
3. Fix the driver changes by hand (no codemod).
4. Generate and commit the row level security migration.
5. Run the integration tests: they now run as a role without superuser rights and catch raw queries without a tenant scope.

## Bun.SQL replaces postgres-js (0.389.0)

`createDbConnection` opens a Bun.SQL pool and needs Bun 1.4.4 or newer. Error codes changed shape, so read them only through the helpers:

```ts illustration
// before
try { await insert(); } catch (err) {
  if (err.code === "23505" && err.constraint_name === "users_email_key") return conflict();
  if (err.code === "CONNECTION_CLOSED") return retryLater();
}

// after
import { extractPgError, isUniqueViolation } from "@cosmicdrift/kumiko-framework/db";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

try { await insert(); } catch (err) {
  if (isUniqueViolation(err) && extractPgError(err)?.constraint_name === "users_email_key") return conflict();
  if (errorCodeOf(err) === "ERR_POSTGRES_CONNECTION_CLOSED") return retryLater();
}
```

Also: drop `onNotice` from `createDbConnection`, remove `DB_PROVIDER` from every environment (boot refuses any value), and remove `postgres` from your dependencies unless your own code imports it. Types named `postgres.Sql` become `SQL` from `"bun"` or the `DbConnection` alias.

## Row level security on by default (0.390.0)

Every tenant table gets Postgres policies, and a statement without a tenant scope sees no tenant rows.

```bash
# once, in the app repo, with the bump
bun kumiko sync-managed --write
bun kumiko schema generate   # migration with ENABLE/FORCE ROW LEVEL SECURITY and the policies
git add kumiko/ && git commit -m "chore: row level security migration"
```

Without the migration the app refuses to boot and names the unprotected tables. The database role must have neither SUPERUSER nor BYPASSRLS.

Code that read tenant tables on a raw connection needs a scope:

```ts illustration
// before: a script read every tenant's invoices on the pool
const { db } = createDbConnection({ url });
const rows = await db.unsafe("SELECT * FROM invoices WHERE status = 'open'");

// after: scope it to the tenant (0 rows otherwise)
const tenantDb = createTenantDb({ db, tenantId });
const rows = await tenantDb.selectMany(invoiceTable, { status: "open" });
```

A command that wrote an entity row for another tenant through `ctx.db` now fails with SQLSTATE 42501; move that write to `ctx.systemDb.acknowledgeCrossTenant` in an `r.systemScope()` feature. A job that only reads across tenants takes `grants: ["crossTenantReads"]`. Details and the escape hatch table: [security defaults](/en/guides/security-defaults/#row-level-security). To go back temporarily, set `rowLevelSecurity: "off"` in `kumiko.config.ts` and generate again.

## Handler context namespaces (0.390.0)

The flat members of `ctx` moved into namespaces, without aliases. The codemod in `kumiko-upgrade --apply` rewrites them:

```ts illustration
// before
handler: async (event, ctx) => {
  await ctx.write("billing:write:invoice:close", { id: event.payload.invoiceId });
  await ctx.appendEvent({ type: "task-closed", aggregateId: event.payload.id, aggregateType: "task", payload: {} });
  ctx.scheduleAfterCommit(() => ctx.log.info("task closed", { tenantId: ctx._tenantId }));
  await ctx.redis.del(`task:${event.payload.id}`);
};

// after
handler: async (event, ctx) => {
  await ctx.dispatch.write("billing:write:invoice:close", { id: event.payload.invoiceId });
  await ctx.events.append({ type: "task-closed", aggregateId: event.payload.id, aggregateType: "task", payload: {} });
  ctx.lifecycle.afterCommit?.(() => ctx.obs.log.info("task closed", { tenantId: ctx.user.tenantId }));
  await ctx.services.redis?.del(`task:${event.payload.id}`);
};
```

| Before | After |
|---|---|
| `ctx.query`, `write`, `queryAs`, `writeAs`, `queryAsMember`, `queryProjection` | `ctx.dispatch.*` |
| `ctx.appendEvent`, `loadAggregate`, `archiveStream`, ... | `ctx.events.append`, `load`, `archive`, ... |
| `ctx.log`, `tracer`, `metrics`, `metricsFor` | `ctx.obs.*` |
| `ctx.scheduleAfterCommit`, `scheduleAfterRollback`, `signal` | `ctx.lifecycle.afterCommit`, `afterRollback`, `signal` |
| `ctx.configFor`, `forTenant` | `ctx.tenants.config`, `writeTarget` |
| `ctx.redis`, `secrets`, `files`, `kms`, `jobRunner`, ... | `ctx.services.*` |
| extra keys of your `extraContext` | `ctx.services.extensions` |
| `ctx.dbOutsideTransaction` | `ctx.db.outsideTransaction` |
| `ctx._tenantId`, `ctx.systemUser` on a handler | `ctx.user.tenantId`, `ctx.user` |

Hooks now receive the `HandlerContext` too. The codemod lists what it cannot resolve: spread literals, untyped receivers, a handler context passed to a function typed `AppContext`. Hand-built test contexts take `services`, `lifecycle` and `tenants` from `bridgeStub({ services })`. The namespace overview is in [Handler context and embedded fields](handler-context-and-embedded-fields.md).

## Feature AST in its own package (0.390.0)

```ts illustration
// before
import { parseFeatureFile, PATTERN_LIBRARY } from "@cosmicdrift/kumiko-framework/engine";
import { runCodemod } from "@cosmicdrift/kumiko-framework/engine/codemod";

// after (add @cosmicdrift/kumiko-feature-ast to the dependencies)
import { parseFeatureFile, PATTERN_LIBRARY } from "@cosmicdrift/kumiko-feature-ast";
import { runCodemod } from "@cosmicdrift/kumiko-feature-ast/codemod";
```

The codemod rewrites the imports and adds the dependency. The framework no longer installs `ts-morph`.

## meilisearch is an optional peer (0.390.0)

```bash
# only apps that import @cosmicdrift/kumiko-framework/search/meilisearch
bun add meilisearch@^0.58.0
```

Without it that import fails at boot with a message naming the package. Apps without the Meilisearch adapter need nothing.

## Smaller public exports (0.390.0)

A name stays exported from a framework subpath only if some package, sample or app outside the framework imports it from there; 1236 unused names were removed from their subpaths. If an import breaks after the bump:

```ts illustration
// before: a removed internal type
import type { SeedTenantRow } from "@cosmicdrift/kumiko-framework/es-ops";

// after: derive the shape from a public type, or declare the few fields you use
type TenantSeed = Pick<HandlerContext, "db" | "obs">;
```

The migration guide lists every removed name per subpath. If you need one back, open an issue on the framework; names added since 0.389.0 stayed public.

## Managed Dockerfile reads the registry token as a secret (0.392.0)

`kumiko-upgrade --apply` rewrites `deploy/Dockerfile`. Builds pass the token with `docker build --secret id=npm_auth_token,env=NPM_AUTH_TOKEN` (or `secrets:` in `docker/build-push-action`) instead of a build arg.
