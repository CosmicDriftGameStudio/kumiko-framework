import { type APIRequestContext, type FullConfig, request } from "@playwright/test";
import * as z from "zod";
import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values";
import { E2E_MEILI_INDEX_PREFIX, MEILI_INDEX_PREFIX_ENV } from "./constants";
import { appDotenvValues } from "./define-app-e2e-config";

const INDEX_PAGE_SIZE = 200;
const HEALTH_TIMEOUT_MS = 1000;
const DELETE_BATCH_SIZE = 50;
// Parallel e2e runs of other sessions share the instance; no run lasts a day, so older indexes
// belong to runs that were killed or skipped their teardown.
const STALE_E2E_INDEX_AGE_MS = 24 * 60 * 60 * 1000;

const indexPageSchema = z.object({
  results: z.array(z.object({ uid: z.string(), createdAt: z.string().optional() })),
  total: z.number(),
});

type MeiliIndex = z.infer<typeof indexPageSchema>["results"][number];

async function isReachable(meili: APIRequestContext): Promise<boolean> {
  try {
    await meili.get("/health", { timeout: HEALTH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function listIndexes(meili: APIRequestContext): Promise<MeiliIndex[]> {
  const indexes: MeiliIndex[] = [];
  for (let offset = 0, total = 1; offset < total; offset += INDEX_PAGE_SIZE) {
    const response = await meili.get("/indexes", {
      params: { limit: INDEX_PAGE_SIZE, offset },
    });
    if (!response.ok()) throw new Error(`index listing answered ${response.status()}`);
    const page = indexPageSchema.parse(await response.json());
    total = page.total;
    indexes.push(...page.results);
  }
  return indexes;
}

function isStaleE2eIndex(index: MeiliIndex, runPrefix: string, nowMs: number): boolean {
  if (!index.uid.startsWith(E2E_MEILI_INDEX_PREFIX) || index.uid.startsWith(runPrefix)) {
    return false;
  }
  // A missing or unreadable timestamp keeps the index: it could belong to a run still going on.
  const createdAtMs = index.createdAt === undefined ? Number.NaN : Date.parse(index.createdAt);
  return nowMs - createdAtMs > STALE_E2E_INDEX_AGE_MS;
}

// Only the first line: Playwright appends a call log that holds the Authorization header.
function firstLineOf(error: unknown): string {
  return String(error).split("\n")[0] ?? "";
}

async function deleteIndexes(meili: APIRequestContext, uids: readonly string[]): Promise<string[]> {
  const failures: string[] = [];
  for (let start = 0; start < uids.length; start += DELETE_BATCH_SIZE) {
    const results = await Promise.allSettled(
      uids.slice(start, start + DELETE_BATCH_SIZE).map(async (uid) => {
        const response = await meili.delete(`/indexes/${uid}`);
        if (!response.ok()) throw new Error(`deleting ${uid} answered ${response.status()}`);
      }),
    );
    for (const result of results) {
      if (result.status === "rejected") failures.push(firstLineOf(result.reason));
    }
  }
  return failures;
}

function reportTeardownProblem(message: string): void {
  process.stderr.write(`e2e teardown: ${message}\n`);
}

// Playwright's client instead of the framework adapter: a failed load of the adapter in the
// runner would leave the indexes behind on an otherwise green run.
export default async function dropRunMeiliIndexes(
  config: Pick<FullConfig, "webServer">,
): Promise<void> {
  const serverEnv = config.webServer?.env ?? {};
  const indexPrefix = serverEnv[MEILI_INDEX_PREFIX_ENV];
  if (!indexPrefix) return;

  // Same order the server resolves: shell (webServer.env), the app's .env files, local default.
  const dotenv = appDotenvValues();
  const apiKey =
    serverEnv["MEILI_MASTER_KEY"] ??
    dotenv["MEILI_MASTER_KEY"] ??
    SERVICE_ENV_DEFAULTS.MEILI_MASTER_KEY;
  const meili = await request.newContext({
    baseURL: serverEnv["MEILI_URL"] ?? dotenv["MEILI_URL"] ?? SERVICE_ENV_DEFAULTS.MEILI_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${apiKey}` },
  });
  try {
    // Without a running instance nothing was indexed; apps without Meilisearch stay silent.
    if (!(await isReachable(meili))) return;
    const indexes = await listIndexes(meili);
    const nowMs = Date.now();
    const runFailures = await deleteIndexes(
      meili,
      indexes.filter((index) => index.uid.startsWith(indexPrefix)).map((index) => index.uid),
    );
    const staleFailures = await deleteIndexes(
      meili,
      indexes
        .filter((index) => isStaleE2eIndex(index, indexPrefix, nowMs))
        .map((index) => index.uid),
    );
    if (runFailures.length > 0) {
      reportTeardownProblem(`Meilisearch indexes of this run not dropped: ${runFailures[0]}`);
    }
    if (staleFailures.length > 0) {
      reportTeardownProblem(
        `${staleFailures.length} stale Meilisearch indexes of earlier e2e runs not dropped: ${staleFailures[0]}`,
      );
    }
  } catch (error) {
    reportTeardownProblem(`Meilisearch indexes of this run not dropped: ${firstLineOf(error)}`);
  } finally {
    await meili.dispose();
  }
}
