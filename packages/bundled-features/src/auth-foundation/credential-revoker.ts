import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { runnerCanBeginTransaction, transaction } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { EXT_CREDENTIAL_REVOKER, isCredentialRevoker } from "./types.ts";

export async function revokeAllUserCredentials(
  registry: Pick<Registry, "getExtensionUsages">,
  runner: DbRunner,
  userId: string,
  options: { readonly keepSessionId?: string | undefined },
): Promise<void> {
  const revokers = registry.getExtensionUsages(EXT_CREDENTIAL_REVOKER).map((usage) => {
    if (!isCredentialRevoker(usage.options)) {
      throw new Error(
        `credentialRevoker usage "${usage.entityName}" of feature "${usage.featureName ?? "unknown"}" has no revokeAllForUser function`,
      );
    }
    return usage.options;
  });

  const runAll = async (target: DbRunner): Promise<void> => {
    for (const revoker of revokers) {
      await revoker.revokeAllForUser(target, userId, options);
    }
  };

  if (runnerCanBeginTransaction(runner)) {
    await transaction(runner, (tx) => runAll(tx));
  } else {
    await runAll(runner);
  }
}
