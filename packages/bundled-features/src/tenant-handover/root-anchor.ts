// The row-bound grant's anchor for a transferable root (see grant.ts): the
// root row's CURRENT tenantId, read via the same SELECT the claim handler
// (which spends the anchor) and the signup-handover verify-only path
// (which never does, see shared/signup-handover.ts) both need — extracted
// so the two callers can't drift on table/column resolution.

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  entityTableFromRegistry,
  executeRawQuery,
  extractTableName,
  physicalColumnName,
} from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { resolveTransferableRoot } from "./transfer-graph";

export type RootAnchorLocation = {
  readonly rootTableName: string;
  readonly rootIdCol: string;
  readonly rootTenantCol: string;
  readonly loadAnchor: (rowId: string) => Promise<string | null>;
};

export function resolveRootAnchorLocation(
  registry: Registry,
  db: DbRunner,
  entityType: string,
): RootAnchorLocation | undefined {
  const rootEntity = resolveTransferableRoot(registry, entityType);
  if (!rootEntity) return undefined;

  const rootTable = entityTableFromRegistry(registry, entityType, rootEntity);
  const rootTableName = extractTableName(rootTable);
  const rootIdCol = physicalColumnName(rootTable, "id");
  const rootTenantCol = physicalColumnName(rootTable, "tenantId");

  return {
    rootTableName,
    rootIdCol,
    rootTenantCol,
    loadAnchor: async (rowId) => {
      const rows = await executeRawQuery<{ tenantId: string }>(
        db,
        `SELECT "${rootTenantCol}" AS "tenantId" FROM "${rootTableName}" WHERE "${rootIdCol}" = $1`,
        [rowId],
      );
      return rows[0]?.tenantId ?? null;
    },
  };
}
