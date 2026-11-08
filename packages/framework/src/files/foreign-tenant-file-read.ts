import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { DbConnection } from "../db/connection.ts";
import { createTenantDb } from "../db/tenant-db.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { isKumikoError } from "../errors/index.ts";
import { createFallbackLogger } from "../logging/index.ts";
import type { FileRef } from "./file-routes.ts";

export type ForeignTenantFileReadCheck = (args: {
  readonly fileRef: FileRef;
  readonly user: SessionUser;
}) => Promise<boolean>;

type QueryAsUser = (type: string, payload: unknown, user: SessionUser) => Promise<unknown>;

const log = createFallbackLogger("files");
const cache = new WeakMap<Registry, ReadonlyMap<string, string>>();

// Event-sourced read models (projection entities) are not in getAllEntities, so both sources count.
export function collectCrossTenantFileReadQueries(registry: Registry): ReadonlyMap<string, string> {
  const cached = cache.get(registry);
  if (cached) return cached;
  const queryByEntityType = new Map<string, string>();
  for (const [name, entity] of registry.getAllEntities()) {
    if (entity.crossTenantFileRead) queryByEntityType.set(name, entity.crossTenantFileRead.query);
  }
  for (const projection of registry.getAllProjections().values()) {
    const name = projection.source;
    if (typeof name !== "string") continue;
    const declaration = registry.getReadModelEntity(name)?.crossTenantFileRead;
    if (declaration) queryByEntityType.set(name, declaration.query);
  }
  cache.set(registry, queryByEntityType);
  return queryByEntityType;
}

// The declared query runs as the requesting user, so its own access and visibility rules decide.
// Only a record carrying the requested id counts; null, other shapes and access errors mean no; the caller's own guard never applies to a foreign tenant's file.
export function createForeignTenantFileReadCheck(
  registry: Registry,
  query: QueryAsUser,
): ForeignTenantFileReadCheck {
  return async ({ fileRef, user }) => {
    const { entityType, entityId } = fileRef;
    if (entityType === null || entityId === null) return false;
    const queryQn = collectCrossTenantFileReadQueries(registry).get(entityType);
    if (queryQn === undefined) return false;
    try {
      const record = await query(queryQn, { id: entityId }, user);
      return propertyOf(record, "id") === entityId;
    } catch (error) {
      if (!isKumikoError(error) || error.httpStatus >= 500) {
        log.error("cross-tenant file read check failed; file access denied", {
          entityType,
          queryQn,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  };
}

// Reads file_refs rows of every tenant, never writes; callers narrow to declared entity types.
export function foreignTenantFileReadDb(db: DbConnection): TenantDb {
  return createTenantDb({
    db,
    tenantId: SYSTEM_TENANT_ID,
    mode: "system",
    reason: "cross-tenant file read of entities that declare crossTenantFileRead",
    grants: { writesDeniedReason: "on the cross-tenant file read handle" },
  });
}
