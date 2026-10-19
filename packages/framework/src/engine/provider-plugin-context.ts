import type {
  HandlerContext,
  JobContext,
  ProviderPluginContext,
} from "@cosmicdrift/kumiko-types/handlers";

export function providerPluginContextFromHandler(ctx: HandlerContext): ProviderPluginContext {
  return {
    db: ctx.db,
    dbOutsideTransaction: ctx.dbOutsideTransaction,
    systemDb: ctx.systemDb,
    registry: ctx.registry,
    user: ctx.user,
    log: ctx.log,
    triggeredBy: ctx.triggeredBy,
    config: ctx.config,
    secrets: ctx.secrets,
  };
}

// Jobs have no request user: the job's system user is the acting identity, and no
// outside-transaction handle exists because jobs never run inside the handler's tx.
export function providerPluginContextFromJob(ctx: JobContext): ProviderPluginContext {
  return {
    db: ctx.db,
    dbOutsideTransaction: undefined,
    systemDb: ctx.systemDb,
    registry: ctx.registry,
    user: ctx.systemUser,
    log: ctx.log,
    triggeredBy: ctx.triggeredBy,
    config: ctx.config,
    secrets: ctx.secrets,
  };
}
