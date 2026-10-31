import type { DbRunner } from "../db/connection.ts";
import { type Registry, SYSTEM_TENANT_ID, type TenantId } from "../engine/types/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { runWithTimeout } from "../utils/run-with-timeout.ts";
import { collectSearchableFieldNames } from "./configure-tenant-index.ts";
import { isEntitySearchable } from "./is-entity-searchable.ts";
import { reindexEntity } from "./reindex-entity.ts";
import type { SearchAdapter } from "./types.ts";

const defaultLog = createFallbackLogger("search");
const DEFAULT_CONFIGURE_TIMEOUT_MS = 5_000;
const DEFAULT_REINDEX_TIMEOUT_MS = 60_000;

export type ReindexTenantsSearchOptions = {
  readonly tenantIds: readonly TenantId[];
  readonly timeoutMs?: number;
  readonly configureTimeoutMs?: number;
  // Scans and builds documents, writes nothing; configure is skipped.
  readonly dryRun?: boolean;
  readonly warn?: (message: string) => void;
};

export type ReindexTenantsSearchResult = {
  readonly tenants: number;
  readonly entities: number;
  readonly indexedRows: number;
  readonly failedRows: number;
  readonly failedReindexes: number;
  readonly failedConfigures: number;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reindexing an unconfigured index falls back to searchableAttributes ["*"],
// so a tenant whose configure failed is reported and skipped, not fatal.
async function configureTolerant(
  tenantIds: readonly TenantId[],
  registry: Registry,
  searchAdapter: SearchAdapter,
  timeoutMs: number,
  warn: (message: string) => void,
): Promise<{ configured: TenantId[]; failedConfigures: number }> {
  const fields = collectSearchableFieldNames(registry);
  const configured: TenantId[] = [];
  let failedConfigures = 0;
  for (const tenantId of tenantIds) {
    const outcome = await runWithTimeout(
      () => searchAdapter.configure(tenantId, { searchableFields: fields, rankingFields: fields }),
      timeoutMs,
    );
    if (outcome.ok) {
      configured.push(tenantId);
    } else {
      failedConfigures += 1;
      warn(`[search] configure for tenant ${tenantId} failed: ${messageOf(outcome.error)}`);
    }
  }
  return { configured, failedConfigures };
}

export async function reindexTenantsSearch(
  db: DbRunner,
  registry: Registry,
  searchAdapter: SearchAdapter,
  options: ReindexTenantsSearchOptions,
): Promise<ReindexTenantsSearchResult> {
  const warn = options.warn ?? ((message: string) => defaultLog.warn(message));
  const reindexTimeoutMs = options.timeoutMs ?? DEFAULT_REINDEX_TIMEOUT_MS;
  const dryRun = options.dryRun === true;

  const { configured, failedConfigures } = dryRun
    ? { configured: [...options.tenantIds], failedConfigures: 0 }
    : await configureTolerant(
        options.tenantIds,
        registry,
        searchAdapter,
        options.configureTimeoutMs ?? DEFAULT_CONFIGURE_TIMEOUT_MS,
        warn,
      );

  let entities = 0;
  let indexedRows = 0;
  let failedRows = 0;
  let failedReindexes = 0;
  for (const [entityName, entity] of registry.getAllEntities()) {
    if (!isEntitySearchable(registry, entityName)) continue;
    entities += 1;
    const targetTenantIds = entity.systemStream === true ? [SYSTEM_TENANT_ID] : configured;
    for (const tenantId of targetTenantIds) {
      const outcome = await runWithTimeout(
        () =>
          reindexEntity(
            db,
            registry,
            searchAdapter,
            entityName,
            tenantId,
            dryRun ? { dryRun } : {},
          ),
        reindexTimeoutMs,
      );
      if (!outcome.ok) {
        failedReindexes += 1;
        warn(
          `[search] reindex "${entityName}" tenant=${tenantId} failed: ${messageOf(outcome.error)}`,
        );
        continue;
      }
      indexedRows += outcome.value.indexedRows;
      if (outcome.value.failures.length > 0) {
        failedRows += outcome.value.failures.length;
        warn(
          `[search] reindex "${entityName}" tenant=${tenantId}: ${outcome.value.failures.length} row(s) failed, first: ${outcome.value.failures[0]?.reason}`,
        );
      }
    }
  }
  return {
    tenants: options.tenantIds.length,
    entities,
    indexedRows,
    failedRows,
    failedReindexes,
    failedConfigures,
  };
}
