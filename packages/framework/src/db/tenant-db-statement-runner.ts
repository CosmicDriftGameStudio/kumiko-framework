import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type { Meter, Tracer } from "@cosmicdrift/kumiko-types/observability";
import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { TenantId } from "../engine/types/identifiers.ts";
import { emitDbQuery } from "../observability/standard-metrics.ts";

import {
  runInRowLevelSecurityScope,
  type TenantDbModeOptions,
  tenantDbRowLevelSecurityScope,
} from "./row-level-security-scope.ts";
import { tableNameOf } from "./table-introspection.ts";

export type TenantDbStatementRunnerOptions = {
  readonly tracer?: Tracer | undefined;
  readonly meter?: Meter | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: TenantId;
} & TenantDbModeOptions;

export type TenantDbOperation = "select" | "insert" | "update" | "delete";

export function createTenantDbStatementRunner({
  tracer,
  meter,
  signal,
  mode,
  reason,
  tenantId,
}: TenantDbStatementRunnerOptions) {
  return function withDbSpan<T>(
    operation: TenantDbOperation,
    table: SchemaTable | EntityTableMeta,
    runner: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    const scope = tenantDbRowLevelSecurityScope(
      mode === "system" ? { mode, reason } : { mode },
      tenantId,
      table,
    );
    const scopedRunner = () => runInRowLevelSecurityScope(scope, runner);
    if (!tracer && !meter) return scopedRunner();
    const tableName = tableNameOf(table);
    const start = performance.now();
    const emitMetric = () => {
      if (meter) {
        emitDbQuery(meter, { operation, table: tableName }, (performance.now() - start) / 1000);
      }
    };

    if (!tracer) {
      return (async () => {
        try {
          return await scopedRunner();
        } finally {
          emitMetric();
        }
      })();
    }

    return tracer.withSpan(
      "db.query",
      {
        kind: "client",
        attributes: {
          "db.system": "postgresql",
          "db.operation": operation,
          "db.table": tableName,
        },
      },
      async (span) => {
        try {
          const result = await scopedRunner();
          if (Array.isArray(result)) {
            span.setAttribute("db.row_count", result.length);
          }
          return result;
        } finally {
          emitMetric();
        }
      },
    );
  };
}
