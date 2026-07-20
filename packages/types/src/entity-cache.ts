import type { EntityId, TenantId } from "./identifiers";

export type EntityCache = {
  /** Get a single cached entity. Returns null on miss. */
  get(
    tenantId: TenantId,
    entityName: string,
    id: EntityId,
  ): Promise<Record<string, unknown> | null>;

  /** Get multiple cached entities. Returns a Map of id → data (misses are absent). */
  mget(
    tenantId: TenantId,
    entityName: string,
    ids: readonly EntityId[],
  ): Promise<Map<EntityId, Record<string, unknown>>>;

  /** Cache a single entity. */
  set(
    tenantId: TenantId,
    entityName: string,
    id: EntityId,
    data: Record<string, unknown>,
  ): Promise<void>;

  /** Cache multiple entities at once. */
  mset(
    tenantId: TenantId,
    entityName: string,
    entries: ReadonlyArray<{ id: EntityId; data: Record<string, unknown> }>,
  ): Promise<void>;

  /** Invalidate a single cached entity. */
  del(tenantId: TenantId, entityName: string, id: EntityId): Promise<void>;
};
