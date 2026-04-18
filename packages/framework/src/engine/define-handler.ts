import type { ZodType, z } from "zod";
import type {
  AccessRule,
  HandlerContext,
  QueryEvent,
  RateLimitOption,
  WriteEvent,
  WriteResult,
} from "./types";

// --- Write Handler Definition ---

export type WriteHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TData = unknown,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly skipTransitionGuard?: boolean;
  readonly rateLimit?: RateLimitOption;
  readonly handler: (
    event: WriteEvent<z.infer<TSchema>>,
    context: HandlerContext,
  ) => Promise<WriteResult<TData>>;
};

export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
>(
  def: WriteHandlerDefinition<TName, TSchema, TData>,
): WriteHandlerDefinition<TName, TSchema, TData> {
  return def;
}

// --- Query Handler Definition ---

export type QueryHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TResult = unknown,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
  readonly handler: (
    query: QueryEvent<z.infer<TSchema>>,
    context: HandlerContext,
  ) => Promise<TResult>;
};

export function defineQueryHandler<
  const TName extends string,
  TSchema extends ZodType,
  TResult = unknown,
>(
  def: QueryHandlerDefinition<TName, TSchema, TResult>,
): QueryHandlerDefinition<TName, TSchema, TResult> {
  return def;
}
