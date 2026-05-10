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
// don't run at build time, so dummy event-payloads are fine.
//
// CLOSURE-BODY CONTRACT: the pipeline-closure body (the function passed
// to `pipeline(...)`) must produce its step-list deterministically based
// on the step-builder `r` alone. Reading `event.payload` outside of
// resolvers (i.e. at the top of the closure, not inside a step's `row:`
// or `data:` callback) is forbidden — at boot the dummy payload is `{}`
// and a closure that branches on payload-fields would pass validation
// while production calls produce a different step-list. A throw at
// boot-time is surfaced cleanly; a quietly-different step-list is not
// caught by this validator. A future lint-rule will enforce the contract
// statically; today it lives in this comment + the StepBuilder doc.

import { getTableName, type Table } from "drizzle-orm";
import { buildPipelineSteps } from "./pipeline";
import type { FeatureDefinition, SessionUser, TenantId, WriteEvent } from "./types";
import type { PipelineDef, StepInstance } from "./types/step";

// Listed step-kinds whose `args.table` must be in the owning feature's
// r.requires.projection allowlist. Extend as further unsafeProjection.*
// steps land — don't pre-list hypothetical kinds (CLAUDE.md: don't design
// for scenarios that can't happen).
const UNSAFE_PROJECTION_KINDS = new Set(["unsafeProjectionUpsert", "unsafeProjectionDelete"]);

// Step-kinds that carry sub-pipelines (M.1.6). Walk into their args to
// extract nested StepInstance arrays so the validator can scan
// unsafeProjection-* nested in branch/forEach (Q17). Without this,
// `r.step.forEach({ do: [r.step.unsafeProjectionUpsert(...)] })`
// would bypass the allowlist gate.
//
// !! REGISTRATION GATE !!
// Every NEW sub-step-builder added in M.2+ MUST register its sub-array-
// arg-paths here, otherwise nested unsafeProjection-* steps escape this
// validator silently. There is no auto-discovery; the test
// "walkAllSteps does NOT recurse into unknown step-kind sub-arrays" in
// pipeline-vertical-slice.test.ts pins that behaviour explicitly so
// the gap is visible.
//
// Self-registration via `defineStep({ subPaths: [...] })` is M.2-Vorlauf
// (Followup #15) — premature with only 2 entries today.
const SUB_PIPELINE_KINDS: Record<string, readonly string[]> = {
  branch: ["onTrue", "onFalse"],
  forEach: ["do"],
};

function* walkAllSteps(steps: readonly StepInstance[]): Generator<StepInstance, void, void> {
  for (const step of steps) {
    yield step;
    const subPaths = SUB_PIPELINE_KINDS[step.kind];
    if (!subPaths) continue;
    const args = step.args as Record<string, unknown>;
    for (const path of subPaths) {
      const subSteps = args[path];
      if (Array.isArray(subSteps)) {
        yield* walkAllSteps(subSteps as readonly StepInstance[]);
      }
    }
  }
}

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

      for (const step of walkAllSteps(steps)) {
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
