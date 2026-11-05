import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createMeilisearchAdapter } from "@cosmicdrift/kumiko-framework/search/meilisearch";
import { MEILI_INDEX_PREFIX_ENV } from "../e2e/constants";
import dropRunMeiliIndexes from "../e2e/drop-run-meili-indexes";
import { waitFor } from "../helpers/wait-for";
import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values";

const MEILI_URL = process.env["MEILI_URL"] ?? SERVICE_ENV_DEFAULTS.MEILI_URL;
const MEILI_MASTER_KEY = process.env["MEILI_MASTER_KEY"] ?? SERVICE_ENV_DEFAULTS.MEILI_MASTER_KEY;

async function meiliAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${MEILI_URL}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

function adapterWithOneIndex(indexPrefix: string) {
  const adapter = createMeilisearchAdapter({
    url: MEILI_URL,
    apiKey: MEILI_MASTER_KEY,
    indexPrefix,
  });
  return {
    adapter,
    created: adapter.configure(crypto.randomUUID() as TenantId, { searchableFields: ["title"] }),
  };
}

async function indexUidsWithPrefix(prefix: string): Promise<string[]> {
  const response = await fetch(`${MEILI_URL}/indexes?limit=1000`, {
    headers: { Authorization: `Bearer ${MEILI_MASTER_KEY}` },
  });
  const page: { results: { uid: string }[] } = await response.json();
  return page.results.map((index) => index.uid).filter((uid) => uid.startsWith(prefix));
}

describe.skipIf(!(await meiliAvailable()))("dropRunMeiliIndexes (live Meilisearch)", () => {
  test("drops the run's indexes and keeps every other prefix", async () => {
    const runPrefix = `test_e2e_run_${crypto.randomUUID()}_`;
    const otherPrefix = `test_e2e_other_${crypto.randomUUID()}_`;
    const run = adapterWithOneIndex(runPrefix);
    const other = adapterWithOneIndex(otherPrefix);
    await Promise.all([run.created, other.created]);

    await dropRunMeiliIndexes({
      webServer: {
        command: "unused",
        env: { [MEILI_INDEX_PREFIX_ENV]: runPrefix, MEILI_URL, MEILI_MASTER_KEY },
      },
    });

    await waitFor(async () => {
      expect(await indexUidsWithPrefix(runPrefix)).toEqual([]);
    });
    expect(await other.adapter.dropAllIndexes?.()).toBe(1);
  });
});
