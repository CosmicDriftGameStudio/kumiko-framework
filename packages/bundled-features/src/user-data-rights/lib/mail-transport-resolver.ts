// Builds a per-tenant mail-transport resolver from a job/handler context, so
// the GDPR notification crons reach the SAME mounted mail-foundation transport
// the request path uses. Mirrors makeTenantStorageProviderResolver — the cron
// ctx carries `configResolver` (the per-request ConfigAccessor exists only in
// the HTTP dispatcher), so the resolver builds a per-tenant accessor from it.
// Without that bridge createTransportForTenant throws "ctx.config is missing"
// in the worker lane (the prod-bug class the file-provider resolver already fixed).

import type { EmailTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createTransportForTenant } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigResolver, Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { createConfigAccessor } from "../../config";

export interface TenantMailResolverCtx {
  readonly registry: Registry;
  // Job-context carries configResolver (per-request ConfigAccessor exists only
  // in the HTTP dispatcher); the resolver builds a per-tenant accessor from it.
  // Undefined → the returned resolver throws (callers gate on mail-availability).
  readonly configResolver: ConfigResolver | undefined;
  readonly secrets: SecretsContext | undefined;
  readonly db: DbConnection;
  readonly userId: string;
  readonly handlerName: string;
}

export function makeTenantMailTransportResolver(
  ctx: TenantMailResolverCtx,
): (tenantId: string) => Promise<EmailTransport> {
  return async (tenantId) => {
    if (!ctx.configResolver) {
      throw new Error(
        `${ctx.handlerName}: ctx.configResolver missing — cannot resolve the mail transport for tenant ${tenantId}`,
      );
    }
    const config = createConfigAccessor(
      ctx.registry,
      ctx.configResolver,
      tenantId as Parameters<typeof createConfigAccessor>[2], // @cast-boundary engine-payload: TenantId brand
      ctx.userId,
      ctx.db,
    );
    return createTransportForTenant(
      { config, registry: ctx.registry, secrets: ctx.secrets, _userId: ctx.userId },
      tenantId,
      ctx.handlerName,
    );
  };
}
