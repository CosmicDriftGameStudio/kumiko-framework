import type { ZodType, z } from "zod";
import type { AccessRule, HandlerContext, QueryEvent, WriteEvent, WriteResult } from "./types";

// --- Write Handler Definition ---

export type WriteHandlerDefinition<TSchema extends ZodType = ZodType, TData = unknown> = {
  readonly name: string;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly handler: (
    event: WriteEvent<z.infer<TSchema>>,
    context: HandlerContext,
  ) => Promise<WriteResult<TData>>;
};

export function defineWriteHandler<TSchema extends ZodType, TData = unknown>(
  def: WriteHandlerDefinition<TSchema, TData>,
): WriteHandlerDefinition<TSchema, TData> {
  return def;
}

// --- Query Handler Definition ---

export type QueryHandlerDefinition<TSchema extends ZodType = ZodType, TResult = unknown> = {
  readonly name: string;
  readonly schema: TSchema;
  readonly access?: AccessRule;
  readonly handler: (
    query: QueryEvent<z.infer<TSchema>>,
    context: HandlerContext,
  ) => Promise<TResult>;
};

export function defineQueryHandler<TSchema extends ZodType, TResult = unknown>(
  def: QueryHandlerDefinition<TSchema, TResult>,
): QueryHandlerDefinition<TSchema, TResult> {
  return def;
}
