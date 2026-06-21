// Builds a per-tenant file-storage-provider resolver from a job/handler
// context, so the export pipeline and the forget pipeline resolve binaries
// through the SAME mounted file-foundation (delete-target == upload-target by
// construction). Extracted from the export cron so both crons + the manual
// forget handler share one construction site instead of inlining it three times.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigResolver, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { createConfigAccessor } from "../../config";
import { createFileProviderForTenant } from "../../file-foundation";

export interface TenantStorageResolverCtx {
  readonly registry: Registry;
  // Job-context carries configResolver (per-request ConfigAccessor exists only
  // in the HTTP dispatcher); the resolver builds a per-tenant accessor from it.
  // Undefined → the returned resolver throws (callers decide fail-loud vs skip).
  readonly configResolver: ConfigResolver | undefined;
  readonly secrets: SecretsContext | undefined;
  readonly db: DbConnection;
  readonly userId: string;
  readonly handlerName: string;
}

export function makeTenantStorageProviderResolver(
  ctx: TenantStorageResolverCtx,
): (tenantId: TenantId) => Promise<FileStorageProvider> {
  return async (tenantId) => {
    if (!ctx.configResolver) {
      throw new Error(
        `${ctx.handlerName}: ctx.configResolver missing — cannot resolve the file provider for tenant ${tenantId}`,
      );
    }
    const config = createConfigAccessor(
      ctx.registry,
      ctx.configResolver,
      tenantId as Parameters<typeof createConfigAccessor>[2], // @cast-boundary engine-payload: TenantId brand
      ctx.userId,
      ctx.db,
    );
    return createFileProviderForTenant(
      { config, registry: ctx.registry, secrets: ctx.secrets, _userId: ctx.userId },
      tenantId,
      ctx.handlerName,
    );
  };
}
