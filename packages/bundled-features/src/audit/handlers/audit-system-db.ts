import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

export function requireAuditSystemDb<TSystemDb>(
  systemDb: TSystemDb | undefined,
  handlerQn: string,
): TSystemDb {
  if (!systemDb) {
    throw new InternalError({
      message: `${handlerQn} requires ctx.systemDb — is r.systemScope() still set on the audit feature?`,
    });
  }
  return systemDb;
}
