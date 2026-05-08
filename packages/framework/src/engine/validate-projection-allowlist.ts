// Boot-validation for r.step.unsafeProjection* allowlist.
//
// Q10 declared the allowlist a hard requirement: every unsafeProjection*
// step must target a table that the owning feature explicitly declared
// via r.requires.projection("table_name"), and that table must NOT be
// one of the registered aggregate-tables (those are managed via
// r.entity / r.step.aggregate.*). Boot-error otherwise.
//
// Mechanism: each writeHandler that uses the perform-pipeline form ships
// a closure. We invoke it once at boot with a minimal dummy event to
// extract the immutable step-list, then walk the list looking for the
// known unsafeProjection-* kinds. Resolvers (the per-step arg-callbacks)
// don't run at build time, so dummy event-payloads are fine — the
// closure-body itself must not read payload-fields outside resolvers,
// and we surface that as a boot-error if it crashes.

import { getTableName, type Table } from "drizzle-orm";
import { buildPipelineSteps } from "./pipeline";
import type { FeatureDefinition, SessionUser, TenantId, WriteEvent } from "./types";
import type { PipelineDef, StepInstance } from "./types/step";

const UNSAFE_PROJECTION_KINDS = new Set(["unsafeProjectionUpsert", "unsafeProjectionDelete"]);

type UnsafeProjectionStepArgs = { readonly table: Table };

const DUMMY_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  tenantId: "00000000-0000-0000-0000-000000000000" as TenantId,
  roles: [],
};

/**
 * Validate every feature's pipeline-form writeHandlers against:
 *   1. the owning feature's r.requires.projection allowlist
 *   2. the cross-feature aggregate-table set (registered via r.entity)
 *
 * Throws on the first violation (fail-fast, consistent with other
 * boot-validations).
 */
export function validateProjectionAllowlist(features: readonly FeatureDefinition[]): void {
  // Aggregate-tables across all features. Map table-name → owning feature.
  const aggregateTables = new Map<string, string>();
  for (const f of features) {
    for (const [entityName, entity] of Object.entries(f.entities)) {
      const tableName = entity.table ?? entityName;
      aggregateTables.set(tableName, f.name);
    }
  }

  for (const f of features) {
    for (const [handlerName, handler] of Object.entries(f.writeHandlers)) {
      const perform = (handler as { readonly perform?: PipelineDef }).perform;
      if (!perform || perform.__kind !== "pipeline") continue;

      let steps: readonly StepInstance[];
      try {
        const dummyEvent: WriteEvent<unknown> = {
          type: handlerName,
          payload: {},
          user: DUMMY_USER,
        };
        steps = buildPipelineSteps(perform, dummyEvent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[Feature ${f.name}] writeHandler "${handlerName}" pipeline-closure threw at boot: ${message}. ` +
            `Closure body must produce the step list without reading event-payload fields ` +
            `(those belong inside step resolvers).`,
        );
      }

      for (const step of steps) {
        if (!UNSAFE_PROJECTION_KINDS.has(step.kind)) continue;
        const stepArgs = step.args as UnsafeProjectionStepArgs;
        if (!stepArgs.table) {
          throw new Error(
            `[Feature ${f.name}] writeHandler "${handlerName}" has a ${step.kind} step ` +
              `without a \`table\` argument.`,
          );
        }
        const tableName = getTableName(stepArgs.table);

        const aggregateOwner = aggregateTables.get(tableName);
        if (aggregateOwner) {
          throw new Error(
            `[Feature ${f.name}] writeHandler "${handlerName}" uses ${step.kind} on table "${tableName}", ` +
              `but that table is the aggregate-projection of feature "${aggregateOwner}" (registered via r.entity). ` +
              `Aggregate-tables MUST be mutated through r.step.aggregate.* — see step-vocabulary.md Q10.`,
          );
        }

        if (!f.requiredProjections.has(tableName)) {
          throw new Error(
            `[Feature ${f.name}] writeHandler "${handlerName}" uses ${step.kind} on table "${tableName}", ` +
              `but the feature did not declare it via r.requires.projection("${tableName}"). ` +
              `Add the declaration in defineFeature("${f.name}", r => { r.requires.projection("${tableName}"); ... }).`,
          );
        }
      }
    }
  }
}
