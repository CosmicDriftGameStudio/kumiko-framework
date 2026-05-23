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

import { getStep } from "./define-step";
import { buildPipelineSteps } from "./pipeline";
import type { FeatureDefinition, SessionUser, TenantId, WriteEvent } from "./types";
import type { PipelineDef, StepInstance } from "./types/step";

// Listed step-kinds whose `args.table` must be in the owning feature's
// r.requires.projection allowlist. Extend as further unsafeProjection.*
// steps land — don't pre-list hypothetical kinds (CLAUDE.md: don't design
// for scenarios that can't happen).
const UNSAFE_PROJECTION_KINDS = new Set(["unsafeProjectionUpsert", "unsafeProjectionDelete"]);

// Sub-pipeline arg-paths come from `defineStep({ subPaths: [...] })` —
// each builder declares its own (e.g. branch's onTrue/onFalse, forEach's
// do). Walking via the registry means nested unsafeProjection-* in NEW
// sub-step-builders is automatically caught the moment the builder
// registers itself; no central map to keep in sync. Followup #15.
function* walkAllSteps(steps: readonly StepInstance[]): Generator<StepInstance, void, void> {
  for (const step of steps) {
    yield step;
    const def = getStep(step.kind);
    const subPaths = def?.subPaths;
    if (!subPaths || subPaths.length === 0) continue;
    const args = step.args as Record<string, unknown>;
    for (const path of subPaths) {
      const subSteps = args[path];
      if (Array.isArray(subSteps)) {
        yield* walkAllSteps(subSteps as readonly StepInstance[]);
      }
    }
  }
}

// @cast-boundary drizzle-bridge — reads table name from drizzle Symbol
// without importing drizzle-orm (bun-db pattern, see bun-db/query.ts).
const DRIZZLE_NAME_SYMBOL = Symbol.for("drizzle:Name");

function resolveTableNameFromStep(table: unknown): string {
  if (typeof table === "object" && table !== null) {
    // EntityTableMeta discriminator
    if ("source" in table && "tableName" in table && typeof (table as Record<string, unknown>)["tableName"] === "string") {
      return (table as Record<string, unknown>)["tableName"] as string;
    }
    // drizzle pgTable
    const name = (table as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL];
    if (typeof name === "string") return name;
  }
  throw new Error(`validate-projection-allowlist: cannot resolve table name from ${String(table)}`);
}

type UnsafeProjectionStepArgs = { readonly table: unknown };

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
  // Two features registering r.entity on the same table is always a bug —
  // physical PG-collision aside, the second feature's writes would replay
  // the first feature's projections (and vice-versa). Detect and surface
  // here so the error names BOTH owners; without this, the silent-set
  // would point any later unsafeProjection-error at the wrong feature.
  // Followup #8.
  const aggregateTables = new Map<string, string>();
  for (const f of features) {
    for (const [entityName, entity] of Object.entries(f.entities)) {
      const tableName = entity.table ?? entityName;
      const existing = aggregateTables.get(tableName);
      if (existing && existing !== f.name) {
        throw new Error(
          `Aggregate-table "${tableName}" is registered by both feature "${existing}" and feature "${f.name}" via r.entity. ` +
            `Each aggregate-table must have a single owning feature — pick distinct table names ` +
            `(via createEntity({ table: "..." })) or remove the duplicate r.entity registration.`,
        );
      }
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
        // Tier-2 step-discovery (Q9): require explicit opt-in via
        // r.requires.step("<kind>") for any tier-2+ step. Tier-1 is implicit.
        const def = getStep(step.kind);
        if (def?.tier === 2 && !f.requiredSteps.has(step.kind)) {
          throw new Error(
            `[Feature ${f.name}] writeHandler "${handlerName}" uses tier-2 step "${step.kind}" ` +
              `but did not declare it via r.requires.step("${step.kind}"). ` +
              `Add the declaration in defineFeature("${f.name}", r => { r.requires.step("${step.kind}"); ... }).`,
          );
        }
        if (!UNSAFE_PROJECTION_KINDS.has(step.kind)) continue;
        const stepArgs = step.args as UnsafeProjectionStepArgs;
        if (!stepArgs.table) {
          throw new Error(
            `[Feature ${f.name}] writeHandler "${handlerName}" has a ${step.kind} step ` +
              `without a \`table\` argument.`,
          );
        }
        const tableName = resolveTableNameFromStep(stepArgs.table);

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
