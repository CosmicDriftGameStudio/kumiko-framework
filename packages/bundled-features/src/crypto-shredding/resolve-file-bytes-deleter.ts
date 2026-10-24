import { deleteFileRefBytes } from "@cosmicdrift/kumiko-framework/derivatives";
import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createFileContext } from "@cosmicdrift/kumiko-framework/files";
import type { DeleteFileBytes } from "../shared/index.ts";

const ERROR_CONTEXT = "crypto-shredding:forget-subject";

// The upload resolver, not ctx.services.files: ctx.services.files is bound to the acting user's tenant, while a
// subject's rows can live in any tenant. Resolved eagerly so a missing provider surfaces as
// missing_file_storage instead of a failed delete.
export function resolveFileBytesDeleter(
  ctx: HandlerContext,
): (tenantId: TenantId) => Promise<DeleteFileBytes | undefined> {
  return async (tenantId) => {
    const resolver = ctx.services._fileProviderResolver;
    if (resolver === undefined) {
      const own = tenantId === ctx.user.tenantId ? ctx.services.files : undefined;
      return own && ((key) => deleteFileRefBytes(own, { storageKey: key }, ERROR_CONTEXT));
    }
    try {
      const provider = await resolver(tenantId);
      const files = createFileContext(() => Promise.resolve(provider), tenantId);
      return (key) => deleteFileRefBytes(files, { storageKey: key }, ERROR_CONTEXT);
    } catch {
      // skip: no provider resolvable for this tenant; surfaces as missing_file_storage when files exist
      return undefined;
    }
  };
}
