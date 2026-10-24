import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  type AppContext,
  createSystemUser,
  type Registry,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import {
  type CreatedFileRef,
  type CreateFileRefInput,
  createFileRefFromBytes,
  createTenantFileContext,
} from "@cosmicdrift/kumiko-framework/files";
import type { Dispatcher } from "@cosmicdrift/kumiko-framework/pipeline";

export type SeedCreateFileRef = (
  tenantId: TenantId,
  input: CreateFileRefInput,
) => Promise<WriteResult<CreatedFileRef>>;

export function makeSeedCreateFileRef(deps: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly context: AppContext;
}): SeedCreateFileRef {
  const { db, registry, context } = deps;
  const fileResolver = context._fileProviderResolver;
  return (tenantId, input) =>
    createFileRefFromBytes(
      {
        db: createTenantDb({ db, tenantId }),
        services: {
          files: fileResolver ? createTenantFileContext(fileResolver, tenantId) : context.files,
        },
        registry,
        user: createSystemUser(tenantId),
      },
      input,
    );
}

// The dispatcher masks a thrown handler error as "internal error" and keeps the
// cause only on a side channel; a seed has no HTTP client to protect, so the
// handler name and cause message go into the message the seed caller sees.
export function withSeedErrorContext<D extends Pick<Dispatcher, "write">>(dispatcher: D): D {
  return {
    ...dispatcher,
    async write(type, payload, user, requestId) {
      const result = await dispatcher.write(type, payload, user, requestId);
      if (result.isSuccess || result.error.code !== "internal_error") return result;
      const cause = reraiseAsKumikoError(result.error).cause;
      const causeMessage = cause instanceof Error ? cause.message : undefined;
      const detail = causeMessage ? `${type}: ${causeMessage}` : type;
      return {
        isSuccess: false,
        error: { ...result.error, message: `${result.error.message} (${detail})` },
      };
    },
  };
}
