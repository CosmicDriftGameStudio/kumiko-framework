import { toKebab } from "../engine/qualified-name.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { isKumikoError } from "../errors/index.ts";
import { createFallbackLogger } from "../logging/index.ts";

export type RecordReadCheck = (args: {
  readonly entityType: string;
  readonly entityId: string;
  readonly user: SessionUser;
}) => Promise<boolean>;

type QueryAsUser = (type: string, payload: unknown, user: SessionUser) => Promise<unknown>;

const log = createFallbackLogger("files");

// Only the "<entity>:detail" handler counts: other "<entity>:...:detail"
// queries map to the same entity but may return a different shape or scope.
// Entity names are globally unique and only the owning feature maps handlers
// to its entity, so at most one QN matches per entity.
function isEntityDetailQuery(qn: string, entityName: string): boolean {
  return qn.endsWith(`:query:${toKebab(entityName)}:detail`);
}

function buildDetailQueryIndex(registry: Registry): ReadonlyMap<string, string> {
  const detailQueryByEntity = new Map<string, string>();
  for (const qn of registry.getAllQueryHandlers().keys()) {
    const entityName = registry.getHandlerEntity(qn);
    if (entityName !== undefined && isEntityDetailQuery(qn, entityName)) {
      detailQueryByEntity.set(entityName, qn);
    }
  }
  for (const projection of registry.getAllProjections().values()) {
    const entityName = projection.source;
    if (typeof entityName !== "string") continue;
    const owner = registry.getReadModelEntityOwner(entityName);
    if (owner === undefined) continue;
    const qn = `${owner}:query:${toKebab(entityName)}:detail`;
    if (registry.getAllQueryHandlers().has(qn)) detailQueryByEntity.set(entityName, qn);
  }
  return detailQueryByEntity;
}

// "May this user read the record?" is answered by the entity's own detail
// query run as that user: handler access, row ownership and parent visibility
// all apply, exactly as when the record is opened. null (not found or not
// visible) and access errors mean no. Entities without a detail query never
// grant access this way.
export function createRecordReadCheck(registry: Registry, query: QueryAsUser): RecordReadCheck {
  let detailQueryByEntity: ReadonlyMap<string, string> | undefined;
  return async ({ entityType, entityId, user }) => {
    detailQueryByEntity ??= buildDetailQueryIndex(registry);
    const detailQuery = detailQueryByEntity.get(entityType);
    if (detailQuery === undefined) return false;
    try {
      const record = await query(detailQuery, { id: entityId }, user);
      return record !== null && record !== undefined;
    } catch (error) {
      if (!isKumikoError(error) || error.httpStatus >= 500) {
        log.error("record read check failed; file access denied", {
          entityType,
          detailQuery,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  };
}
