// Step-Vocabulary Types — see kumiko-platform/docs/archive/plans/architecture/intern/step-vocabulary.md
//
// M.1 minimal scope:
//   - Steps execute against the existing HandlerContext (no per-step subset).
//   - steps-accumulator is Record<string, unknown> (no tuple-reduce typing).
//   - Resolvers receive the full PipelineCtx as one argument.
//
// Strict typing on appendEvent inside steps is deferred to a later pass
// (see TS-typing notes in the design doc). M.1 uses unsafeAppendEvent
// semantics under the hood for r.step.aggregate.appendEvent.

import type { EventStoreExecutor } from "./event-store-executor-types.ts";
import type { KumikoEventTypeMap } from "./event-type-map.ts";
import type { HandlerContext, WriteEvent, WriteResult } from "./handlers.ts";
import type { SaveContext } from "./hooks.ts";
import type { EntityId } from "./identifiers.ts";
import type { WhereObject } from "./where-clause-types.ts";

/**
 * The kind discriminator for a step instance — matches the step's
 * registration name in the step-registry (e.g. "return", "compute",
 * "aggregate.create"). Steps register themselves at module-load time
 * via defineStep().
 */
export type StepKind = string;

/**
 * Pipeline-side context handed to step argument resolvers.
 *
 * Contains the full HandlerContext (no per-step subset in M.1) plus
 * the accumulated `steps` map of prior step results, and a `scope`
 * record for forEach/branch-local bindings.
 *
 * `scope` is `Record<string, unknown>` — sub-step builders (forEach,
 * branch) populate it once they land in later M.1 slices. M.1.1 ships
 * with `r.step.return` only, which reads `event` and ignores both
 * `steps` and `scope`.
 */
export type PipelineCtx<
  TPayload = unknown,
  TMap extends object = KumikoEventTypeMap,
> = HandlerContext<TMap> & {
  readonly event: WriteEvent<TPayload>;
  readonly steps: Readonly<Record<string, unknown>>;
  readonly scope: Readonly<Record<string, unknown>>;
};

/**
 * A resolver is either a static value or a function that derives the
 * value from the pipeline-context. M.1 keeps the resolver signature
 * uniform — every step accepts both forms via a normalise helper.
 */
export type StepResolver<T, TPayload = unknown> = T | ((ctx: PipelineCtx<TPayload>) => T);

export type StepDef<TArgs = unknown, TResult = unknown> = {
  readonly kind: StepKind;
  // Returns the result-key for this step instance, or undefined when the
  // step doesn't surface a result. The first-position name on the call
  // (e.g. r.step.compute("startedAt", fn) → "startedAt") becomes the key.
  readonly resultKey?: (args: TArgs) => string | undefined;
  // Sub-pipeline arg-paths — names of `args.<path>` entries that hold a
  // readonly StepInstance[] (e.g. branch's `["onTrue", "onFalse"]`, forEach's
  // `["do"]`). The boot-validator reads these at registration time so it
  // can recurse into nested pipelines without a hardcoded kind-list. Steps
  // that don't carry sub-pipelines omit the field. Self-registration
  // prevents future sub-step-builders from silently bypassing the
  // unsafeProjection allowlist by forgetting to update a central map.
  readonly subPaths?: readonly string[];
  // Step-vocabulary tier. Tier-1 implicit, Tier-2+ requires
  // r.requires.step("<kind>") in the owning feature. Default 1 (implicit).
  readonly tier?: 1 | 2;
  // Runtime: resolve the args against the ctx, perform the work, return
  // the value to land in steps.{resultKey}. Thrown errors propagate to
  // the dispatcher's catch.
  readonly run: (args: TArgs, ctx: PipelineCtx) => Promise<TResult> | TResult;
};

/**
 * An instance of a step in a pipeline — what users build via the
 * step-builder (`r.step.compute(...)`). Carries the kind and the resolved-or-resolver args.
 *
 * `args` is `unknown` at this layer — the registered StepDef knows the
 * concrete shape and casts at run() time. Cross-step type-safety lives
 * in the per-step builder factories, not in this central type.
 */
export type StepInstance = {
  readonly kind: StepKind;
  readonly args: unknown;
};

/**
 * What `stepsPipeline(closure)` returns. Carries the closure (instead of an
 * eagerly-built array) so each handler-call sees a fresh event ref and
 * the `r` step-builder is resolved at runtime, not at module-load time.
 *
 * `__kind: "pipeline"` lets defineWriteHandler distinguish a pipeline-
 * form `perform` from accidental other shapes.
 *
 * `_TData` is a phantom type-parameter — held in constraint position
 * only, never referenced in the type body. defineWriteHandler binds it
 * via `def.perform: PipelineDef<…, TData>` (the call-site uses TData
 * without underscore — phantom-prefix is purely a Biome
 * `noUnusedVariables` marker, not user-facing). _TData is NOT inferred
 * from the closure body (r.step.return has its own per-call TData), so
 * callers must spell it explicitly:
 *   `stepsPipeline<{ greeting: string }, { echoed: string }>(...)`
 * Better DX is a known follow-up — see step-vocabulary.md M.1-Followups.
 */
export type PipelineDef<TPayload = unknown, _TData = unknown> = {
  readonly __kind: "pipeline";
  readonly build: (ctx: PipelineBuildCtx<TPayload>) => readonly StepInstance[];
};

/**
 * Argument bundle passed to the closure inside `stepsPipeline(closure)`.
 * Build-time only — no `steps`, no `scope`, no `db`: at build time no
 * step has run yet.
 *
 * The closure is invoked ONCE per handler-call and returns the immutable
 * list of step instances. Values inside the closure that depend on prior
 * step results MUST go through resolvers (functions) — those receive the
 * resolver-side PipelineCtx which carries `steps` + `scope`.
 *
 * **Closure-body contract:** the closure must produce a deterministic
 * step-list that doesn't depend on `event.payload` — branching on payload
 * fields belongs inside resolvers (where they fire per-call), not in the
 * outer closure body. Boot-validation runs the closure once with a dummy
 * empty payload to scan unsafeProjection-* step targets; a closure that
 * conditionally builds different step-lists per payload would silently
 * skip validation. See validate-projection-allowlist.ts for the
 * boot-side mechanics.
 */
export type PipelineBuildCtx<TPayload = unknown> = {
  readonly event: WriteEvent<TPayload>;
  readonly r: StepBuilder;
};

/**
 * Step-builder namespace handed to the pipeline closure. The fields
 * grow as M.1 adds more steps. Each is a thin factory that returns a
 * StepInstance — the runtime resolution happens later in run().
 *
 * Why nested under `step`: matches the doc-API surface and leaves room
 * for future sibling namespaces (`r.trigger`, `r.transform`) without
 * crowding the top-level r.
 */
export type StepBuilder = {
  readonly step: StepNamespace;
};

/**
 * The collection of step factory functions. Grown incrementally —
 * landed: return (M.1.1), compute (M.1.2), unsafeProjectionUpsert
 * (M.1.3), aggregate.create (M.1.4). Pending: branch, forEach,
 * read.*, aggregate.update, aggregate.appendEvent,
 * unsafeProjectionDelete.
 */
export type StepNamespace = {
  readonly return: <TData>(resolver: StepResolver<WriteResult<TData>>) => StepInstance;
  readonly compute: <TResult>(name: string, fn: (ctx: PipelineCtx) => TResult) => StepInstance;
  // Boot-validation enforces that the table is in the owning feature's
  // r.requires.projection allowlist and is not registered as an aggregate
  // table via r.entity.
  readonly unsafeProjectionUpsert: (args: {
    readonly table: unknown;
    readonly on: readonly string[];
    readonly row: StepResolver<Record<string, unknown>>;
  }) => StepInstance;
  // Sibling: delete row(s) from a read-side projection table. Same
  // boot-validation contract as unsafeProjectionUpsert.
  readonly unsafeProjectionDelete: (args: {
    readonly table: unknown;
    readonly where: StepResolver<WhereObject>;
  }) => StepInstance;
  // Read sub-namespace — thin wrapper on selectMany/fetchOne (db/query.ts).
  // Tenant-filtered like ctx.db; unsafeAllTenants needs escapeHatch on the handler (or systemScope).
  readonly read: {
    readonly findOne: (
      name: string,
      opts: {
        readonly table: unknown;
        readonly where: StepResolver<WhereObject | undefined>;
        readonly unsafeAllTenants?: { readonly reason: string };
      },
    ) => StepInstance;
    readonly findMany: (
      name: string,
      opts: {
        readonly table: unknown;
        readonly where?: StepResolver<WhereObject | undefined>;
        readonly limit?: number;
        readonly unsafeAllTenants?: { readonly reason: string };
      },
    ) => StepInstance;
  };
  // Aggregate-mutation sub-namespace — wraps the existing event-store-
  // executor surface. Every method goes through the full ES pipeline
  // (events + projections + lifecycle hooks + audit). The default and
  // intended path for domain mutation; contrast with unsafeProjection.*.
  readonly aggregate: {
    readonly create: (
      name: string,
      opts: {
        readonly executor: EventStoreExecutor;
        readonly data: StepResolver<Record<string, unknown>>;
      },
    ) => StepInstance;
    readonly update: (
      name: string,
      opts: {
        readonly executor: EventStoreExecutor;
        readonly id: StepResolver<EntityId>;
        readonly changes: StepResolver<Record<string, unknown>>;
        readonly version?: StepResolver<number | undefined>;
        readonly skipOptimisticLock?: boolean;
      },
    ) => StepInstance;
    readonly appendEvent: (args: {
      readonly aggregateId: StepResolver<string>;
      readonly aggregateType: string;
      readonly type: string;
      readonly payload: StepResolver<unknown>;
      readonly headers?: StepResolver<Readonly<Record<string, string | number | boolean>>>;
    } & (
      | { readonly expectedVersion: StepResolver<number>; readonly blindAppendReason?: never }
      | { readonly blindAppendReason: string; readonly expectedVersion?: never }
    )) => StepInstance;
  };
  // Conditional sub-pipeline. `onTrue` (required) and `onFalse`
  // (optional) are static StepInstance arrays; `r` for sub-step builders
  // is captured from the outer pipeline closure. Naming-Q14: `onTrue`/
  // `onFalse` over `then`/`else` because Biome's noThenProperty lint
  // flags `then` as a thenable-trap. Q12: r.step.return inside
  // onTrue/onFalse is rejected at build time (would trigger
  // discriminated-union TData trap). Q13: no resultKey — branch is
  // side-effect-only.
  readonly branch: (args: {
    readonly if: StepResolver<boolean>;
    readonly onTrue: readonly StepInstance[];
    readonly onFalse?: readonly StepInstance[];
  }) => StepInstance;
  // Iterate a sub-pipeline over an array. `as` is required;
  // current item lands under `scope[as]` for resolvers in `do`.
  // Sequential only; concurrency is not yet supported.
  readonly forEach: <TItem = unknown>(args: {
    readonly over: StepResolver<readonly TItem[]>;
    readonly as: string;
    readonly do: readonly StepInstance[];
    readonly concurrency?: 1;
  }) => StepInstance;
  // Tier-2: requires r.requires.step("callFeature") in the owning feature.
  readonly callFeature: (
    name: string,
    opts: {
      readonly handler: string;
      readonly payload: StepResolver<unknown>;
      readonly as?: import("./handlers.ts").SessionUser;
    },
  ) => StepInstance;
};

// SaveContext is the result-type of aggregate.create / aggregate.update;
// re-exported for step authors who want to type their resolver bindings.
export type AggregateStepResult = SaveContext;
