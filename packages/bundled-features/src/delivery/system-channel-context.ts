import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigAccessor, Registry } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { buildChannelContext } from "./channel-context.ts";
import type { ChannelContext } from "./types.ts";

export type SystemChannelContextDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly filesForTenant: (tenantId: string) => FileContext | undefined;
};

export type SystemChannelContextOptions = {
  readonly config?: ConfigAccessor;
  readonly secrets?: SecretsContext;
};

export function buildSystemChannelContext(
  deps: SystemChannelContextDeps,
  options: SystemChannelContextOptions = {},
): ChannelContext {
  return buildChannelContext(
    deps.db,
    deps.registry,
    undefined,
    SYSTEM_TENANT_ID,
    options.secrets,
    options.config,
    deps.filesForTenant,
  );
}
