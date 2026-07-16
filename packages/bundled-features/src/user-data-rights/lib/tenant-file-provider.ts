// Resolves the GDPR-download file-storage provider explicitly for
// `jobRow.requestedFromTenantId` instead of the ambient request tenant.
//
// Both download handlers (by-token, by-job) used to call
// `createFileProviderForTenant(ctx, jobRow.requestedFromTenantId, ...)`,
// which reads the PROVIDER SELECTION from `ctx.config` — bound to the
// caller's own ambient tenant, not the job's tenant:
//   - by-token (anonymous magic-link, httpRoute): under
//     `resolverTrust: "authoritative"` without `defaultTenantId` there is
//     no ambient tenant at all — `ctx.config` throws, 500s the whole
//     GDPR download flow.
//   - by-job (session-authed): a user can own jobs across tenants
//     (cross-tenant-same-user); the ambient session tenant silently
//     picks the WRONG tenant's provider config for a job requested from
//     a different tenant.
//
// Fix: build a fresh config accessor bound explicitly to the given
// tenantId (same construction as `makeTenantStorageProviderResolver`,
// which the export/forget crons already use), instead of the ambient
// `ctx.config`. Deliberately NOT `ctx._fileProviderResolver` — that
// resolver is boot-built and per-tenant-cached for the process lifetime,
// so an operator switching `file-foundation:config:provider` mid-session
// wouldn't take effect until the cache evicts.
import type { DbConnection, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigResolver, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { createConfigAccessor } from "../../config";
import { createFileProviderForTenant } from "../../file-foundation";

export interface TenantFileProviderCtx {
  readonly registry?: Registry;
  readonly configResolver?: ConfigResolver;
  readonly secrets?: SecretsContext;
  readonly db: { readonly raw: DbConnection | TenantDb };
}

export async function resolveTenantFileProvider(
  ctx: TenantFileProviderCtx,
  tenantId: string,
  handlerName: string,
): Promise<FileStorageProvider> {
  if (!ctx.registry || !ctx.configResolver) {
    throw new Error(
      `${handlerName}: ctx.registry/ctx.configResolver missing — cannot resolve the file provider for tenant ${tenantId}`,
    );
  }
  const config = createConfigAccessor(
    ctx.registry,
    ctx.configResolver,
    tenantId as TenantId, // @cast-boundary engine-payload: TenantId brand
    SYSTEM_USER_ID,
    ctx.db.raw,
    ctx.secrets,
  );
  return createFileProviderForTenant(
    { config, registry: ctx.registry, secrets: ctx.secrets, _userId: SYSTEM_USER_ID },
    tenantId,
    handlerName,
  );
}
