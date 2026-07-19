import { seedAllConfigValues } from "@cosmicdrift/kumiko-bundled-features/config";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { EnvelopeCipher } from "@cosmicdrift/kumiko-framework/secrets";

// Single boot-seed entry-point. runDevApp + runProdApp both call this
// from their post-stack hook, so the wiring lives in exactly one place
// — config-seed-boot.integration.ts pins this helper, which means a
// missing call site (e.g. someone deletes the line from runDevApp)
// surfaces as a missing-helper-use in code review rather than silently
// shipping a server that never seeds.
// @wrapper-known semantic-alias
export async function applyBootSeeds(deps: {
  registry: Registry;
  db: DbConnection;
  cipher?: EnvelopeCipher;
}): Promise<void> {
  await seedAllConfigValues(deps.registry, deps.db, deps.cipher);
}
