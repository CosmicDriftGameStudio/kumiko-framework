import type { ZodType, z } from "zod";
import type { KumikoEventTypeMap } from "./event-type-map";
import type {
  AccessRule,
  HandlerContext,
  QueryEvent,
  RateLimitOption,
  WriteEvent,
  WriteResult,
} from "./handlers";
import type { PipelineDef } from "./step";

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
