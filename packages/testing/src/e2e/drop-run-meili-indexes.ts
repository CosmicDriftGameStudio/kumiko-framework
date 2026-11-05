import { type APIRequestContext, type FullConfig, request } from "@playwright/test";
import * as z from "zod";
import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values";
import { MEILI_INDEX_PREFIX_ENV } from "./constants";

const INDEX_PAGE_SIZE = 200;
const HEALTH_TIMEOUT_MS = 1000;

const indexPageSchema = z.object({
  results: z.array(z.object({ uid: z.string() })),
  total: z.number(),
});

async function isReachable(meili: APIRequestContext): Promise<boolean> {
  try {
    await meili.get("/health", { timeout: HEALTH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function dropIndexesWithPrefix(meili: APIRequestContext, indexPrefix: string): Promise<void> {
  const uids: string[] = [];
  for (let offset = 0, total = 1; offset < total; offset += INDEX_PAGE_SIZE) {
    const response = await meili.get("/indexes", {
      params: { limit: INDEX_PAGE_SIZE, offset },
    });
    if (!response.ok()) throw new Error(`index listing answered ${response.status()}`);
    const page = indexPageSchema.parse(await response.json());
    total = page.total;
    for (const { uid } of page.results) {
      if (uid.startsWith(indexPrefix)) uids.push(uid);
    }
  }
  await Promise.all(
    uids.map(async (uid) => {
      const response = await meili.delete(`/indexes/${uid}`);
      if (!response.ok()) throw new Error(`deleting ${uid} answered ${response.status()}`);
    }),
  );
}

// Playwright's client instead of the framework adapter: a failed load of the adapter in the
// runner would leave the indexes behind on an otherwise green run.
export default async function dropRunMeiliIndexes(
  config: Pick<FullConfig, "webServer">,
): Promise<void> {
  const serverEnv = config.webServer?.env ?? {};
  const indexPrefix = serverEnv[MEILI_INDEX_PREFIX_ENV];
  if (!indexPrefix) return;

  const apiKey = serverEnv["MEILI_MASTER_KEY"] ?? SERVICE_ENV_DEFAULTS.MEILI_MASTER_KEY;
  const meili = await request.newContext({
    baseURL: serverEnv["MEILI_URL"] ?? SERVICE_ENV_DEFAULTS.MEILI_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${apiKey}` },
  });
  try {
    // Without a running instance nothing was indexed; apps without Meilisearch stay silent.
    if (await isReachable(meili)) await dropIndexesWithPrefix(meili, indexPrefix);
  } catch (error) {
    // Only the first line: Playwright appends a call log that holds the Authorization header.
    const reason = String(error).split("\n")[0];
    process.stderr.write(`e2e teardown: Meilisearch indexes of this run not dropped: ${reason}\n`);
  } finally {
    await meili.dispose();
  }
}
