import type * as z from "zod";
import type { ZodType } from "zod";
import type { KumikoEventTypeMap } from "./event-type-map.ts";
import type {
  AccessRule,
  AgentHandlerHints,
  BeforeTransactionPhase,
  EscapeHatchDeclaration,
  HandlerContext,
  PayloadRateLimitOption,
  PreparedWriteEvent,
  PreTransactionReservation,
  QueryEvent,
  RateLimitDeclaration,
  WriteHandlerTransactionMode,
  WriteResult,
} from "./handlers.ts";
import type { PipelineDef } from "./step.ts";

// --- Write Handler Definition ---
//
// TMap propagates the strict event-type-map through the handler's
// HandlerContext. CRITICAL: TMap is declared as a generic parameter on the
// FUNCTION (defineWriteHandler), not just on the type. Generic-functions
// substitute TMap at the USE-site (the caller's compile context, where
// the augmentation is visible); generic-type-aliases substitute at the
// definition-site (framework's compile, where the augmentation isn't
// visible) and collapse `keyof TMap` to `never`. See the spike-findings
// memory for the empirical proof.
//
// Two authoring forms — `handler` (free-form) or `perform: stepsPipeline(...)`
// (step-pipeline). A `perform` is compiled to a handler-function at
// definition time; the dispatcher only ever sees `handler`.

export type WriteHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
  TPrepared = undefined,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  /** Set by the entity convention create/update handlers; see WriteHandlerDef.excludedFields. */
  readonly excludedFields?: readonly string[];
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitDeclaration;
  readonly additionalRateLimits?: readonly PayloadRateLimitOption[];
  /** Tokens each request books on every declared rateLimit bucket, computed from the validated
   *  payload (e.g. `(p) => p.files.length`). Replaces the options' `cost`; results below 1 count as 1. */
  readonly rateLimitCost?: (payload: z.infer<TSchema>) => number;
  readonly escapeHatch?: EscapeHatchDeclaration;
  readonly reserveBeforeTransaction?: PreTransactionReservation;
  readonly beforeTransaction?: BeforeTransactionPhase<z.infer<TSchema>, TPrepared>;
  readonly tenantlessAnonymous?: boolean;
  readonly transaction?: WriteHandlerTransactionMode;
  readonly handler: (
    event: PreparedWriteEvent<z.infer<TSchema>, TPrepared>,
    context: HandlerContext<TMap>,
  ) => Promise<WriteResult<TData>>;
  // Preserved when the author wrote a `perform` block — the original
  // PipelineDef. Designer/AI/AST tools read this when present; the
  // dispatcher ignores it and just calls `handler`. Absent on free-form
  // handlers.
  readonly perform?: PipelineDef<z.infer<TSchema>, TData>;
};

// Author-facing input — accepts either the free-form `handler` or the
// pipeline-form `perform`. defineWriteHandler narrows them to the
// canonical WriteHandlerDefinition shape.
export type WriteHandlerInput<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
  TPrepared = undefined,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitDeclaration;
  readonly additionalRateLimits?: readonly PayloadRateLimitOption[];
  /** Tokens each request books on every declared rateLimit bucket, computed from the validated
   *  payload (e.g. `(p) => p.files.length`). Replaces the options' `cost`; results below 1 count as 1. */
  readonly rateLimitCost?: (payload: z.infer<TSchema>) => number;
  readonly escapeHatch?: EscapeHatchDeclaration;
  readonly reserveBeforeTransaction?: PreTransactionReservation;
  readonly beforeTransaction?: BeforeTransactionPhase<z.infer<TSchema>, TPrepared>;
  readonly tenantlessAnonymous?: boolean;
  readonly transaction?: WriteHandlerTransactionMode;
} & (
  | {
      readonly handler: (
        event: PreparedWriteEvent<z.infer<TSchema>, TPrepared>,
        context: HandlerContext<TMap>,
      ) => Promise<WriteResult<TData>>;
      readonly perform?: never;
    }
  | {
      readonly perform: PipelineDef<z.infer<TSchema>, TData>;
      readonly handler?: never;
    }
);

// --- Query Handler Definition ---

export type QueryHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TResult = unknown,
  TMap extends object = KumikoEventTypeMap,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  readonly rateLimit?: RateLimitDeclaration;
  readonly escapeHatch?: EscapeHatchDeclaration;
  readonly handler: (
    query: QueryEvent<z.infer<TSchema>>,
    context: HandlerContext<TMap>,
  ) => Promise<TResult>;
  /** Zod schema of `handler`'s actual return value — see QueryHandlerDef's
   *  doc (handlers.ts) for the boot-validator checks this unlocks. Not
   *  inferred from `TResult`: TResult is a compile-time-only type param
   *  (this function never receives a runtime schema for it), so callers
   *  that want boot-time column checks declare `outputSchema` explicitly,
   *  same as `schema` for the input side. */
  readonly outputSchema?: ZodType;
  /** Entities whose changes this query reflects. Anonymous callers with
   *  access to this query receive /api/sse change signals (no field values)
   *  for these entities. Every name must be a registered entity. */
  readonly liveEntities?: readonly string[];
};

// --- Stream Handler Definition ---
//
// Scaffolding only — access/rateLimit read by the boot-validator,
// dispatch-time consumption (async-generator, SSE) lands later.

export type StreamHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TChunk = unknown,
  TMap extends object = KumikoEventTypeMap,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access: AccessRule;
  readonly rateLimit?: RateLimitDeclaration;
  // Stream handlers can't reach db.global() (that gate is write-only), but
  // they can still switch identity to SYSTEM via ctx.dispatch.queryAs — this opts
  // in, same contract as WriteHandlerDefinition.escapeHatch.
  readonly escapeHatch?: EscapeHatchDeclaration;
  readonly handler: (
    query: QueryEvent<z.infer<TSchema>>,
    context: HandlerContext<TMap>,
  ) => AsyncGenerator<TChunk>;
};
