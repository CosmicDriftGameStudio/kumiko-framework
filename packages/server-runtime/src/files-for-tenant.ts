import { fileContextFromResolver } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { type AppContext, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";

// Takes the AppContext buildServer returned: only that one carries `_fileProviderResolver`.
// Without a resolver, `context.files` is bound to the system tenant and reaches no other one.
export function makeFilesForTenant(
  context: AppContext,
): (tenantId: string) => FileContext | undefined {
  const resolver = context._fileProviderResolver;
  if (resolver) return (tenantId) => fileContextFromResolver(resolver, tenantId);
  return (tenantId) => (tenantId === SYSTEM_TENANT_ID ? context.files : undefined);
}
