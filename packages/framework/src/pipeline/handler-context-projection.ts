import { selectMany } from "../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import { hasTenantColumn } from "../db/tenant-db.ts";
import { InternalError } from "../errors/index.ts";
import { requireDbSource } from "./dispatch-context-helpers.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { createGatedProjectionReader, type ProjectionReader } from "./system-identity-switch.ts";

// queryProjection works against both single-stream and multi-stream
// projections. MSPs without a table cannot be queried — those are
// side-effect-only consumers (no state to read back).
export function buildHandlerProjectionReader(scope: HandlerContextScope): ProjectionReader {
  const { ctx, type, user, tx, registry, hasIdentitySwitchGrant, identitySwitchAudit } = scope;
  const findProjectionTable = (qualifiedName: string) =>
    registry.getAllProjections().get(qualifiedName)?.table ??
    registry.getAllMultiStreamProjections().get(qualifiedName)?.table;
  const ungatedQueryProjection: ProjectionReader = async <T = Record<string, unknown>>(
    qualifiedName: string,
    queryOptions?: { readonly unsafeAllTenants?: boolean },
  ): Promise<readonly T[]> => {
    const projTable = findProjectionTable(qualifiedName);
    if (!projTable) {
      const singleNames = [...registry.getAllProjections().keys()];
      const mspNames = [...registry.getAllMultiStreamProjections().keys()].filter(
        (n) => registry.getAllMultiStreamProjections().get(n)?.table,
      );
      const all = [...singleNames, ...mspNames];
      throw new InternalError({
        message:
          `ctx.dispatch.queryProjection("${qualifiedName}") — projection not registered, or it is a ` +
          `table-less MSP (side-effect-only). Known queryable projections: ${all.join(", ") || "(none)"}`,
      });
    }
    const dbSource = requireDbSource(ctx, tx, `ctx.dispatch.queryProjection("${qualifiedName}")`);
    const allTenants = queryOptions?.unsafeAllTenants === true;
    const where =
      hasTenantColumn(projTable) && !allTenants ? { tenantId: user.tenantId } : undefined;
    const read = () => selectMany<Record<string, unknown>>(dbSource, projTable, where);
    const rows = await (allTenants
      ? runInSystemRowLevelSecurityScope(
          "handler projection read with allTenants spans every tenant",
          read,
        )
      : read());
    return rows as readonly T[]; // @cast-boundary engine-payload
  };
  return createGatedProjectionReader(
    `handler "${type}"`,
    hasIdentitySwitchGrant,
    ungatedQueryProjection,
    identitySwitchAudit,
    (qualifiedName) => {
      const projTable = findProjectionTable(qualifiedName);
      // Unknown projection: keep the grant check first, the ungated reader reports the real error.
      return projTable === undefined || hasTenantColumn(projTable);
    },
  );
}
