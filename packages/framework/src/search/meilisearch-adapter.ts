import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { EnqueuedTaskPromise, FilterableAttributes, Task } from "meilisearch";
import type { EntityId, TenantId } from "../engine/types/identifiers.ts";
import { importOptionalPeer } from "../utils/import-optional-peer.ts";
import {
  type MeilisearchAdapterOptions,
  meilisearchTenantIndex,
} from "./meilisearch-adapter-internals.ts";
import {
  buildPieceDocuments,
  entityPiecesFilter,
  filterTypeClause,
  stalePiecesFilter,
} from "./meilisearch-chunking.ts";
import { MEILISEARCH_PEER } from "./meilisearch-peer.ts";
import type { SearchAdapter, SearchAdapterConfig, SearchDocument, SearchResult } from "./types.ts";

// meilisearch is an optional peer; a static import would fail with the runtime's bare
// "Cannot find package" error instead of naming the peer and how to install it.
const { ErrorStatusCode, Meilisearch } = await importOptionalPeer(
  MEILISEARCH_PEER,
  () => import("meilisearch"),
);

// meilisearch's waitTask() RESOLVES (never rejects) once the server task
// reaches a terminal state, even "failed" — a rejected doc (e.g. an id over
// Meili's 511-byte limit) otherwise fails silently and the caller thinks
// the write succeeded. Route every waitTask() through here so a non-
// "succeeded" status always throws, except for the error codes a caller
// declares as an already-reached end state.
async function awaitSucceededTask(
  enqueued: EnqueuedTaskPromise,
  toleratedErrorCodes: readonly string[] = [],
): Promise<Task> {
  const task = await enqueued.waitTask();
  const tolerated = task.error ? toleratedErrorCodes.includes(task.error.code) : false;
  if (task.status !== "succeeded" && !tolerated) {
    // Only the code: Meili's message can embed the whole rejected document (missing_document_id),
    // and this error ends up in the consumer's lastError and the logs. The task uid leads to it.
    const detail = task.error ? task.error.code : "no error code";
    throw new Error(
      `Meilisearch task ${task.uid} (${task.type}) ended with status "${task.status}": ${detail}`,
    );
  }
  return task;
}

// A tenant whose index was never created (no default config, nothing ever
// indexed) has nothing to delete: the remove's end state already holds.
// Without this, a delete event or a DSGVO subject purge for such a tenant
// would fail forever.
const REMOVE_TOLERATED_ERROR_CODES: readonly string[] = [ErrorStatusCode.INDEX_NOT_FOUND];

const INDEX_LIST_PAGE_SIZE = 100;

// What an unconfigured Meilisearch index reports as searchableAttributes.
const MEILI_ALL_ATTRIBUTES = "*";

// _entityId and _chunk back the piece filters (stale-piece cleanup, remove); distinct on
// _entityId makes an entity with several matching pieces appear once in the results.
const DISTINCT_ATTRIBUTE = "_entityId";
const DEFAULT_FILTERABLE_ATTRIBUTES: readonly string[] = [
  "_type",
  "_weight",
  DISTINCT_ATTRIBUTE,
  "_chunk",
];
const DEFAULT_SORTABLE_ATTRIBUTES: readonly string[] = ["_weight"];

// Filters per deleteDocuments call: one task per call, and the filter string stays short.
const DELETE_FILTER_BATCH = 100;

function defaultSearchableAttributes(config: SearchAdapterConfig): readonly string[] {
  return config.rankingFields ?? config.searchableFields;
}

// Meilisearch may return granular filterable objects; those are never part of our default.
function isSubsetOf(stored: readonly unknown[], wanted: readonly string[]): boolean {
  return stored.every((attribute) => typeof attribute === "string" && wanted.includes(attribute));
}

// A stored list that lies inside the current default and misses attributes is an
// older default that gained fields since; anything with a foreign attribute is
// an explicit configure() and stays untouched. Known limit: an explicit configure() that
// narrowed to a strict subset of the default is indistinguishable and gets widened again.
function isOutdatedDefault(
  stored: {
    searchable: readonly unknown[];
    filterable: readonly unknown[];
    sortable: readonly unknown[];
  },
  wanted: {
    searchable: readonly string[];
    filterable: readonly string[];
    sortable: readonly string[];
  },
  distinctMissing: boolean,
): boolean {
  const pairs = [
    [stored.searchable, wanted.searchable],
    [stored.filterable, wanted.filterable],
    [stored.sortable, wanted.sortable],
  ] as const;
  return (
    pairs.every(([have, want]) => isSubsetOf(have, want)) &&
    (distinctMissing ||
      pairs.some(([have, want]) => want.some((attribute) => !have.includes(attribute))))
  );
}

type ConfigAction =
  | { readonly kind: "apply-default" }
  | { readonly kind: "keep" }
  | { readonly kind: "add-filterable"; readonly filterable: NonNullable<FilterableAttributes> };

function isIndexNotFound(err: unknown): boolean {
  const cause = typeof err === "object" && err !== null && "cause" in err ? err.cause : null;
  return errorCodeOf(cause) === ErrorStatusCode.INDEX_NOT_FOUND;
}

// Exported for unit tests (index-name / primary-key shape) without a live Meili.
// Meilisearch primary-key-ids: alphanumerics, `-`, `_`. UUIDs contain `-` —
// legal. Replace anything else just in case callers pass unexpected shapes.

export function createMeilisearchAdapter(options: MeilisearchAdapterOptions): SearchAdapter {
  const client = new Meilisearch({ host: options.url, apiKey: options.apiKey });
  const prefix = options.indexPrefix ?? "kumiko_";

  // Set via setDefaultConfig once the registry is known (server.ts boot).
  // undefined until then — tenants stay unconfigured, matching prior behavior.
  let defaultConfig: SearchAdapterConfig | undefined;
  // Per-tenant configure state. An explicit `configure(tenantId, ...)` call
  // always wins and is never overwritten by the lazy default — its promise
  // sits in the map exactly like a lazily-triggered one.
  const configuredTenants = new Map<TenantId, Promise<void>>();

  // Exact inverse of meilisearchTenantIndex. A bare startsWith(prefix) would also
  // match a longer sibling prefix (`kumiko_` vs `kumiko_staging_`) sharing the
  // instance; tenant ids never contain `_`, which excludes that sibling.
  function isOwnTenantIndex(uid: string): boolean {
    return uid.startsWith(prefix) && /^t[0-9A-Za-z-]+$/.test(uid.slice(prefix.length));
  }

  async function applyConfig(tenantId: TenantId, config: SearchAdapterConfig): Promise<void> {
    const index = client.index(meilisearchTenantIndex(prefix, tenantId));
    await awaitSucceededTask(
      index.updateSearchableAttributes([...defaultSearchableAttributes(config)]),
    );
    await awaitSucceededTask(index.updateFilterableAttributes([...DEFAULT_FILTERABLE_ATTRIBUTES]));
    await awaitSucceededTask(index.updateSortableAttributes([...DEFAULT_SORTABLE_ATTRIBUTES]));
    await awaitSucceededTask(index.updateDistinctAttribute(DISTINCT_ATTRIBUTE));
  }

  // Filter deletes need the filterable attributes, but a tenant whose index was never created has
  // nothing to delete and must not get an empty index out of a delete.
  async function ensureConfiguredIfIndexExists(tenantId: TenantId): Promise<boolean> {
    if (!configuredTenants.has(tenantId)) {
      try {
        await client.getIndex(meilisearchTenantIndex(prefix, tenantId));
      } catch (err) {
        if (isIndexNotFound(err)) return false;
        throw err;
      }
    }
    await ensureConfigured(tenantId);
    return true;
  }

  async function deleteByFilters(tenantId: TenantId, filters: readonly string[]): Promise<void> {
    const index = client.index(meilisearchTenantIndex(prefix, tenantId));
    await writeForgettingConfigOnFailure(tenantId, async () => {
      for (let offset = 0; offset < filters.length; offset += DELETE_FILTER_BATCH) {
        const filter = filters.slice(offset, offset + DELETE_FILTER_BATCH).join(" OR ");
        await awaitSucceededTask(index.deleteDocuments({ filter }), REMOVE_TOLERATED_ERROR_CODES);
      }
    });
  }

  // All pieces first, then the leftovers of an earlier, longer version: a failure in between
  // leaves a document that is too long, never a hole.
  async function writeDocuments(
    tenantId: TenantId,
    docs: readonly SearchDocument[],
  ): Promise<void> {
    const index = client.index(meilisearchTenantIndex(prefix, tenantId));
    const pieces = docs.flatMap(buildPieceDocuments);
    await writeForgettingConfigOnFailure(tenantId, async () => {
      await awaitSucceededTask(index.addDocuments(pieces, { primaryKey: "_id" }));
    });
    await deleteByFilters(
      tenantId,
      docs.map((doc) =>
        stalePiecesFilter(doc.entityType, doc.entityId, buildPieceDocuments(doc).length),
      ),
    );
  }

  // Lazily configures a tenant's index off the default config on its first
  // access, so callers that never call `configure` still get a filterable/
  // sortable index instead of failing with "not filterable"/"index not
  // found". A failed configure is never memoized — remove the map entry (iff
  // it's still the same in-flight promise) and rethrow, so a transient
  // Meili outage doesn't permanently poison the tenant for the process.
  // The configured-tenants map is process memory only: after a restart a stored explicit
  // configure() must not be overwritten by the registry default, so the default is applied only
  // to an index that is missing, carries Meilisearch's factory settings, or holds an older
  // default that is a strict subset of the current one (fields were added by a deploy).
  // A kept index still gets the default filterable attributes merged in: remove, purge and the
  // stale-piece delete filter on them, and an index without them rejects every delete.
  async function configActionFor(
    tenantId: TenantId,
    config: SearchAdapterConfig,
  ): Promise<ConfigAction> {
    try {
      const settings = await client.index(meilisearchTenantIndex(prefix, tenantId)).getSettings();
      const searchable = settings.searchableAttributes ?? [MEILI_ALL_ATTRIBUTES];
      const filterable = settings.filterableAttributes ?? [];
      const factorySettings =
        searchable.length === 1 &&
        searchable[0] === MEILI_ALL_ATTRIBUTES &&
        !filterable.includes("_type");
      const needsDefault =
        factorySettings ||
        isOutdatedDefault(
          { searchable, filterable, sortable: settings.sortableAttributes ?? [] },
          {
            searchable: defaultSearchableAttributes(config),
            filterable: DEFAULT_FILTERABLE_ATTRIBUTES,
            sortable: DEFAULT_SORTABLE_ATTRIBUTES,
          },
          settings.distinctAttribute !== DISTINCT_ATTRIBUTE,
        );
      if (needsDefault) return { kind: "apply-default" };
      const missing = DEFAULT_FILTERABLE_ATTRIBUTES.filter(
        (attribute) => !filterable.includes(attribute),
      );
      return missing.length === 0
        ? { kind: "keep" }
        : { kind: "add-filterable", filterable: [...filterable, ...missing] };
    } catch (err) {
      if (isIndexNotFound(err)) return { kind: "apply-default" };
      throw err;
    }
  }

  async function ensureConfigured(tenantId: TenantId): Promise<void> {
    // skip: no registry-derived default — callers configure tenants explicitly.
    if (!defaultConfig) return;
    const existing = configuredTenants.get(tenantId);
    if (existing) {
      await existing;
      // skip: configured (or in flight) already for this tenant.
      return;
    }
    const config = defaultConfig;
    await trackConfigure(tenantId, async () => {
      const action = await configActionFor(tenantId, config);
      if (action.kind === "apply-default") await applyConfig(tenantId, config);
      if (action.kind === "add-filterable") {
        await awaitSucceededTask(
          client
            .index(meilisearchTenantIndex(prefix, tenantId))
            .updateFilterableAttributes(action.filterable),
        );
      }
    });
  }

  async function trackConfigure(tenantId: TenantId, run: () => Promise<void>): Promise<void> {
    const pending = run();
    configuredTenants.set(tenantId, pending);
    try {
      await pending;
    } catch (err) {
      if (configuredTenants.get(tenantId) === pending) {
        configuredTenants.delete(tenantId);
      }
      throw err;
    }
  }

  // A rejected write can mean another writer recreated or reconfigured the index since this
  // process configured it; forgetting the tenant makes the next write re-check its settings.
  async function writeForgettingConfigOnFailure(
    tenantId: TenantId,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (err) {
      configuredTenants.delete(tenantId);
      throw err;
    }
  }

  return {
    setDefaultConfig(config) {
      defaultConfig = config;
    },

    async configure(tenantId, config) {
      await trackConfigure(tenantId, () => applyConfig(tenantId, config));
    },

    async index(tenantId, doc) {
      await ensureConfigured(tenantId);
      await writeDocuments(tenantId, [doc]);
    },

    async indexBatch(tenantId, docs) {
      // skip: empty batch — avoid an unnecessary Meilisearch round-trip
      if (docs.length === 0) return;
      await ensureConfigured(tenantId);
      await writeDocuments(tenantId, docs);
    },

    async dropAllIndexes() {
      // An empty prefix matches every index, which would wipe the whole Meili instance.
      if (prefix === "") {
        throw new Error("refusing to drop Meilisearch indexes with an empty prefix");
      }
      const uids: string[] = [];
      for (let offset = 0; ; offset += INDEX_LIST_PAGE_SIZE) {
        const page = await client.getIndexes({ limit: INDEX_LIST_PAGE_SIZE, offset });
        for (const index of page.results) {
          if (isOwnTenantIndex(index.uid)) uids.push(index.uid);
        }
        if (page.results.length === 0 || offset + page.results.length >= page.total) break;
      }
      // Cleared even when a delete throws midway: otherwise ensureConfigured treats the
      // already-dropped tenants as configured and the next index() recreates an
      // unconfigured index ("not filterable" on filtered search).
      try {
        for (const uid of uids) {
          await awaitSucceededTask(client.deleteIndex(uid), REMOVE_TOLERATED_ERROR_CODES);
        }
      } finally {
        configuredTenants.clear();
      }
      return uids.length;
    },

    async removeBatch(tenantId, items) {
      // skip: empty batch — avoid an unnecessary Meilisearch round-trip
      if (items.length === 0) return;
      // skip: the tenant has no index, so nothing is left to remove
      if (!(await ensureConfiguredIfIndexExists(tenantId))) return;
      await deleteByFilters(
        tenantId,
        items.map((item) => entityPiecesFilter(item.entityType, item.entityId)),
      );
    },

    async search(tenantId, query, options) {
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));

      const filter: string[] = [];
      if (options?.filterType) {
        filter.push(filterTypeClause(options.filterType));
      }

      const searchParams: Record<string, unknown> = {
        limit: options?.limit ?? 50,
        sort: ["_weight:desc"],
      };
      if (filter.length > 0) searchParams["filter"] = filter;

      const results = await index.search(query, searchParams);

      return results.hits.map(
        (hit: Record<string, unknown>): SearchResult => ({
          entityType: hit["_type"] as string, // @cast-boundary engine-bridge
          entityId: hit["_entityId"] as EntityId, // @cast-boundary engine-bridge
        }),
      );
    },

    async remove(tenantId, entityType, entityId) {
      // skip: the tenant has no index, so nothing is left to remove
      if (!(await ensureConfiguredIfIndexExists(tenantId))) return;
      await deleteByFilters(tenantId, [entityPiecesFilter(entityType, entityId)]);
    },
  };
}
