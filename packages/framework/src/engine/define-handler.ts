import type { ZodType, z } from "zod";
import type {
  AccessRule,
  HandlerContext,
  KumikoEventTypeMap,
  QueryEvent,
  RateLimitOption,
  WriteEvent,
  WriteResult,
} from "./types";

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

export type WriteHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly skipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitOption;
  readonly handler: (
    event: WriteEvent<z.infer<TSchema>>,
    context: HandlerContext<TMap>,
  ) => Promise<WriteResult<TData>>;
};

export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
>(
  def: WriteHandlerDefinition<TName, TSchema, TData, TMap>,
): WriteHandlerDefinition<TName, TSchema, TData, TMap> {
  return def;
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
