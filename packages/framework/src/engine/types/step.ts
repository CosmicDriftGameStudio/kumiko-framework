// Step-Vocabulary Types — see docs/plans/architecture/intern/step-vocabulary.md
//
// M.1 minimal scope:
//   - Steps execute against the existing HandlerContext (no per-step subset).
//   - steps-accumulator is Record<string, unknown> (no tuple-reduce typing).
//   - Resolvers receive the full PipelineCtx as one argument.
//
// Strict typing on appendEvent inside steps is deferred to a later pass
// (see TS-typing notes in the design doc). M.1 uses unsafeAppendEvent
// semantics under the hood for r.step.aggregate.appendEvent.

import type { SQL, Table } from "drizzle-orm";
import type { EventStoreExecutor } from "../../db/event-store-executor";
import type { KumikoEventTypeMap } from "./event-type-map";
import type { HandlerContext, WriteEvent, WriteResult } from "./handlers";
import type { SaveContext } from "./hooks";
import type { EntityId } from "./identifiers";

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

/**
 * Per-step error strategy. M.1.1 only supports "throw" — the type is
 * deliberately narrowed so callers cannot pass an unsupported strategy
 * past the type-checker. The doc lists "return" / "skip" / fallback as
 * future strategies; each lands together with its own runtime support
 * + integration test in a later slice (no untested type expansion).
 */
export type StepFailureStrategy = "throw";

export type StepDef<TArgs = unknown, TResult = unknown> = {
  readonly kind: StepKind;
  readonly defaultFailureStrategy: StepFailureStrategy;
  // Returns the result-key for this step instance, or undefined when the
  // step doesn't surface a result. The first-position name on the call
  // (e.g. r.step.compute("startedAt", fn) → "startedAt") becomes the key.
  readonly resultKey?: (args: TArgs) => string | undefined;
  // Sub-pipeline arg-paths — names of `args.<path>` entries that hold a
  // readonly StepInstance[] (e.g. branch's `["onTrue", "onFalse"]`, forEach's
  // `["do"]`). The boot-validator reads these at registration time so it
  // can recurse into nested pipelines without a hardcoded kind-list. Steps
  // that don't carry sub-pipelines omit the field. Followup #15 self-
  // registration: prevents future sub-step-builders from silently bypassing
  // the unsafeProjection allowlist by forgetting to update a central map.
  readonly subPaths?: readonly string[];
  // Step-vocabulary tier (Q9). Tier-1 implicit, Tier-2+ requires
  // r.requires.step("<kind>") in the owning feature. Default 1 (implicit).
  readonly tier?: 1 | 2;
  // Runtime: resolve the args against the ctx, perform the work, return
  // the value to land in steps.{resultKey}. Thrown errors propagate to
  // the dispatcher's catch (M.1.1 supports "throw"-strategy only).
  readonly run: (args: TArgs, ctx: PipelineCtx) => Promise<TResult> | TResult;
};

/**
 * An instance of a step in a pipeline — what users build via the
 * step-builder (`r.step.compute(...)`). Carries the kind + resolved-or-
 * resolver args + the user-chosen onFailure override.
 *
 * `args` is `unknown` at this layer — the registered StepDef knows the
 * concrete shape and casts at run() time. Cross-step type-safety lives
 * in the per-step builder factories, not in this central type.
 */
export type StepInstance = {
  readonly kind: StepKind;
  readonly args: unknown;
  readonly onFailure?: StepFailureStrategy;
};

/**
 * What `pipeline(closure)` returns. Carries the closure (instead of an
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
 *   `pipeline<{ greeting: string }, { echoed: string }>(...)`
 * Better DX is a known follow-up — see step-vocabulary.md M.1-Followups.
 */
export type PipelineDef<TPayload = unknown, _TData = unknown> = {
  readonly __kind: "pipeline";
  readonly build: (ctx: PipelineBuildCtx<TPayload>) => readonly StepInstance[];
};

/**
 * Argument bundle passed to the closure inside `pipeline(closure)`.
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
  // Inline read-side projection write. Boot-validation enforces the
  // table is in the owning feature's r.requires.projection allowlist
  // and NOT registered as an aggregate-table via r.entity. See
  // step-vocabulary.md "Was unsafeProjection.* überspringt".
  readonly unsafeProjectionUpsert: (args: {
    readonly table: Table;
    readonly on: readonly string[];
    readonly row: StepResolver<Record<string, unknown>>;
  }) => StepInstance;
  // Sibling: delete row(s) from a read-side projection table. Same
  // boot-validation contract as unsafeProjectionUpsert.
  readonly unsafeProjectionDelete: (args: {
    readonly table: Table;
    readonly where: StepResolver<SQL>;
  }) => StepInstance;
  // Read sub-namespace — thin wrapper on ctx.db.select(). Caller-owned
  // tenant-filter (does NOT auto-inject like ctx.queryProjection does).
  readonly read: {
    readonly findOne: (
      name: string,
      opts: {
        readonly table: Table;
        readonly where: StepResolver<SQL | undefined>;
      },
    ) => StepInstance;
    readonly findMany: (
      name: string,
      opts: {
        readonly table: Table;
        readonly where?: StepResolver<SQL | undefined>;
        readonly limit?: number;
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
    }) => StepInstance;
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
  // Iterate a sub-pipeline over an array. `as` is required (Q15);
  // current item lands under `scope[as]` for resolvers in `do`.
  // Sequential only in M.1.6; concurrency is Followup #12.
  readonly forEach: <TItem = unknown>(args: {
    readonly over: StepResolver<readonly TItem[]>;
    readonly as: string;
    readonly do: readonly StepInstance[];
    readonly concurrency?: 1;
  }) => StepInstance;
  // Tier-2 namespace. Each builder requires r.requires.step("<kind>")
  // in the owning feature; boot-validation enforces.
  readonly webhook: {
    readonly send: (args: {
      readonly url: StepResolver<string>;
      readonly method?: "POST" | "PUT" | "PATCH";
      readonly headers?: StepResolver<Readonly<Record<string, string>>>;
      readonly body?: StepResolver<unknown>;
      readonly auth?:
        | { readonly kind: "bearer"; readonly secretRef: string }
        | { readonly kind: "header"; readonly name: string; readonly secretRef: string };
      readonly mode: "deferred";
      readonly retry?: { readonly times: number; readonly backoff: "exponential" | "linear" };
    }) => StepInstance;
  };
  readonly mail: {
    readonly send: (args: {
      readonly to: StepResolver<string | readonly string[]>;
      readonly subject: StepResolver<string>;
      readonly body: StepResolver<string>;
      readonly from?: StepResolver<string>;
      readonly mode: "deferred";
    }) => StepInstance;
  };
  readonly callFeature: (
    name: string,
    opts: {
      readonly handler: string;
      readonly payload: StepResolver<unknown>;
      readonly as?: import("./handlers").SessionUser;
    },
  ) => StepInstance;
};

// SaveContext is the result-type of aggregate.create / aggregate.update;
// re-exported for step authors who want to type their resolver bindings.
export type AggregateStepResult = SaveContext;
