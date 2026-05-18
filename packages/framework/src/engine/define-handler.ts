import type { ZodType, z } from "zod";
import { runPipeline } from "./run-pipeline";
import type {
  AccessRule,
  HandlerContext,
  KumikoEventTypeMap,
  QueryEvent,
  RateLimitOption,
  WriteEvent,
  WriteResult,
} from "./types";
import type { PipelineDef } from "./types/step";

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
// Two authoring forms — `handler` (free-form) or `perform: pipeline(...)`
// (step-pipeline). A `perform` is compiled to a handler-function at
// definition time; the dispatcher only ever sees `handler`.

export type WriteHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitOption;
  readonly handler: (
    event: WriteEvent<z.infer<TSchema>>,
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
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitOption;
} & (
  | {
      readonly handler: (
        event: WriteEvent<z.infer<TSchema>>,
        context: HandlerContext<TMap>,
      ) => Promise<WriteResult<TData>>;
      readonly perform?: never;
    }
  | {
      readonly perform: PipelineDef<z.infer<TSchema>, TData>;
      readonly handler?: never;
    }
);

export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap>,
): WriteHandlerDefinition<TName, TSchema, TData, TMap> {
  // Runtime-guard against accidentally setting BOTH handler+perform.
  // The discriminated-union type-error
  //   "Type 'PipelineDef<...>' is not assignable to type 'undefined'."
  // is functional but cryptic for less TS-experienced users; this throws
  // a name-and-explanation error message instead. Followup #3.
  // The cast is necessary because the discriminated union narrows
  // `handler` away once `perform` is present (and vice-versa) — at this
  // boundary we want to read both regardless of the narrowing.
  const probe = def as {
    readonly handler?: unknown;
    readonly perform?: unknown;
    readonly name: TName;
  };
  if (probe.handler !== undefined && probe.perform !== undefined) {
    throw new Error(
      `defineWriteHandler("${def.name}"): both \`handler\` and \`perform\` are set. ` +
        `Pick one — \`handler\` for the free-form async function, ` +
        `\`perform: pipeline(...)\` for the step-pipeline form. ` +
        `(See step-vocabulary.md for which form fits.)`,
    );
  }

  // Conditional spreads (`...(def.access && { access: def.access })`)
  // mirror the existing convention in entity-handlers.ts /
  // define-feature.ts — optional fields stay absent rather than being
  // serialised as `key: undefined`.
  const base = {
    name: def.name,
    schema: def.schema,
    ...(def.access && { access: def.access }),
    ...(def.unsafeSkipTransitionGuard && {
      unsafeSkipTransitionGuard: def.unsafeSkipTransitionGuard,
    }),
    ...(def.rateLimit && { rateLimit: def.rateLimit }),
  };

  if ("perform" in def && def.perform !== undefined) {
    const performDef = def.perform;
    const compiledHandler = async (
      event: WriteEvent<z.infer<TSchema>>,
      ctx: HandlerContext<TMap>,
    ): Promise<WriteResult<TData>> => {
      return runPipeline<z.infer<TSchema>, TData, TMap>(performDef, event, ctx);
    };
    return { ...base, handler: compiledHandler, perform: performDef };
  }

  return { ...base, handler: def.handler };
}

// --- Query Handler Definition ---

export type QueryHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TResult = unknown,
  TMap extends object = KumikoEventTypeMap,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
  readonly handler: (
    query: QueryEvent<z.infer<TSchema>>,
    context: HandlerContext<TMap>,
  ) => Promise<TResult>;
};

export function defineQueryHandler<
  const TName extends string,
  TSchema extends ZodType,
  TResult = unknown,
  TMap extends object = KumikoEventTypeMap,
>(
  def: QueryHandlerDefinition<TName, TSchema, TResult, TMap>,
): QueryHandlerDefinition<TName, TSchema, TResult, TMap> {
  return def;
}
