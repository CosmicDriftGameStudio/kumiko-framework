import type { CursorResult } from "@cosmicdrift/kumiko-types/cursor-types";
import type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-types/event-type-map";
import type {
  BeforeTransactionWhenNested,
  EscapeHatchGrant,
  SystemScopeHandlerContext,
  WriteEvent,
} from "@cosmicdrift/kumiko-types/handlers";
import {
  ENTITY_CONVENTION_QUERY_BRAND,
  ENTITY_CONVENTION_WRITE_BRAND,
  escapeHatchAllows,
  hasCrossTenantReads,
} from "@cosmicdrift/kumiko-types/handlers";
import type { CrossTenantReads } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type * as z from "zod";
import type { ZodType } from "zod";
import { isAgentToolCallScope } from "../api/request-context-scopes.ts";
import { hasSystemDb } from "../db/tenant-db.ts";
import { AccessDeniedError, InternalError } from "../errors/index.ts";
import { isMemberResolutionPrincipal } from "../pipeline/dispatch-context-helpers.ts";
import type { ContainsSecret } from "../secrets/types.ts";
import { bootRuleError } from "./boot-validator/boot-rule.ts";
import { DEFINITION_HANDLER_RULES } from "./boot-validator/definition-handlers-rules.ts";
import { runPipeline } from "./run-pipeline.ts";
import type {
  QueryHandlerDefinition,
  QueryHandlerInput,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./types/define-handler.ts";
import type { HandlerContext } from "./types/index.ts";

export type {
  QueryHandlerDefinition,
  QueryHandlerInput,
  StreamHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./types/define-handler.ts";

function pickPreTransactionPhases<
  TName extends string,
  TSchema extends ZodType,
  TData,
  TMap extends object,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>,
): Pick<
  WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>,
  "reserveBeforeTransaction" | "beforeTransaction" | "beforeTransactionWhenNested"
> {
  return {
    ...(def.reserveBeforeTransaction && { reserveBeforeTransaction: def.reserveBeforeTransaction }),
    ...(def.beforeTransaction && { beforeTransaction: def.beforeTransaction }),
    ...(def.beforeTransactionWhenNested && {
      beforeTransactionWhenNested: def.beforeTransactionWhenNested,
    }),
  };
}

// `in` keeps both branches of the discriminated union readable regardless of narrowing.
function hasHandlerAndPerform(def: object): boolean {
  return (
    "handler" in def && def.handler !== undefined && "perform" in def && def.perform !== undefined
  );
}

function assertSingleHandlerForm(def: object & { readonly name: string }): void {
  if (!hasHandlerAndPerform(def)) return;
  throw bootRuleError(DEFINITION_HANDLER_RULES.handlerAndPerformBoth, {
    message:
      `defineWriteHandler("${def.name}"): both \`handler\` and \`perform\` are set. ` +
      `Pick one — \`handler\` for the free-form async function, ` +
      `\`perform: stepsPipeline(...)\` for the step-pipeline form. ` +
      `(See step-vocabulary.md for which form fits.)`,
  });
}

function pickWriteHandlerMetadata<
  TName extends string,
  TSchema extends ZodType,
  TData,
  TMap extends object,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>) {
  return {
    name: def.name,
    schema: def.schema,
    ...(def.access && { access: def.access }),
    ...(def.description !== undefined && { description: def.description }),
    ...(def.agent && { agent: def.agent }),
    ...(def.rateLimit && { rateLimit: def.rateLimit }),
    ...(def.additionalRateLimits && { additionalRateLimits: def.additionalRateLimits }),
    ...(def.rateLimitCost && { rateLimitCost: def.rateLimitCost }),
  };
}

function pickWriteHandlerSafetyFlags<
  TName extends string,
  TSchema extends ZodType,
  TData,
  TMap extends object,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>) {
  return {
    ...(def.unsafeSkipTransitionGuard && { unsafeSkipTransitionGuard: true }),
    ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
    ...(def.systemScope === true && { systemScope: true as const }),
    ...(def.dispatchOnly && { dispatchOnly: true }),
    ...(def.tenantlessAnonymous && { tenantlessAnonymous: true }),
    ...(def.transaction && { transaction: def.transaction }),
  };
}

// The declaration promises ctx.systemDb; a dispatch without it (feature lacks r.systemScope()
// or no db is wired) fails here, naming the handler, instead of deep inside the handler.
function systemScopeContext<TMap extends object>(
  ctx: HandlerContext<TMap>,
  handlerName: string,
): SystemScopeHandlerContext<TMap> {
  if (!hasSystemDb(ctx)) {
    throw new InternalError({
      message:
        `Handler "${handlerName}" declares systemScope: true but ran without ctx.systemDb — ` +
        "its feature must call r.systemScope() and the app context must wire a db.",
    });
  }
  return ctx;
}

// Agent tool calls and resolved member principals never receive ctx.crossTenantReads by design
// (handler-context-db.ts, handler-context-member-resolution.ts), so those are denials; any other
// absence means the app context wired no db.
function crossTenantReadsContext<
  TContext extends Pick<HandlerContext, "crossTenantReads" | "user">,
>(ctx: TContext, handlerName: string): TContext & { readonly crossTenantReads: CrossTenantReads } {
  if (hasCrossTenantReads(ctx)) return ctx;
  if (isAgentToolCallScope()) {
    throw new AccessDeniedError({
      message: `Handler "${handlerName}" declares the crossTenantReads grant, which an agent tool call never receives.`,
    });
  }
  if (isMemberResolutionPrincipal(ctx.user)) {
    throw new AccessDeniedError({
      message: `Handler "${handlerName}" declares the crossTenantReads grant, which a resolved member principal never receives.`,
    });
  }
  throw new InternalError({
    message:
      `Handler "${handlerName}" declares the crossTenantReads grant but ran without ctx.crossTenantReads — ` +
      "the app context must wire a db.",
  });
}

function grantedContext<TContext extends Pick<HandlerContext, "crossTenantReads" | "user">>(
  ctx: TContext,
  handlerName: string,
  readsGranted: boolean,
): TContext {
  return readsGranted ? crossTenantReadsContext(ctx, handlerName) : ctx;
}

function compileWriteHandler<
  TName extends string,
  TSchema extends ZodType,
  TData,
  TMap extends object,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>,
): WriteHandlerDefinition<TName, TSchema, TData, TMap, TPrepared, TWhenNested>["handler"] {
  const handlerName = def.name;
  const readsGranted = escapeHatchAllows(def.escapeHatch, "crossTenantReads");
  if (def.perform !== undefined) {
    const performDef = def.perform;
    const declaresSystemScope = def.systemScope === true;
    return async (event: WriteEvent<z.infer<TSchema>>, ctx: HandlerContext<TMap>) =>
      runPipeline<z.infer<TSchema>, TData, TMap>(
        performDef,
        event,
        grantedContext(
          declaresSystemScope ? systemScopeContext(ctx, handlerName) : ctx,
          handlerName,
          readsGranted,
        ),
      );
  }
  if (def.systemScope === true) {
    const systemHandler = def.handler;
    return async (event, ctx) =>
      systemHandler(
        event,
        grantedContext(systemScopeContext(ctx, handlerName), handlerName, readsGranted),
      );
  }
  if (!readsGranted) return def.handler;
  const grantedHandler = def.handler;
  return async (event, ctx) => grantedHandler(event, crossTenantReadsContext(ctx, handlerName));
}

export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
  TPrepared = undefined,
  TWhenNested extends BeforeTransactionWhenNested | undefined = undefined,
  TGrant extends EscapeHatchGrant = EscapeHatchGrant,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested, TGrant>,
  // R6: a phantom rest-param. When the inferred response `TData` carries a
  // Secret<> anywhere, ContainsSecret<TData> is `true` and this resolves to a
  // 1-tuple the caller can't supply → compile error at the leak site. Clean
  // responses get `[]`, so existing call-sites are unaffected. Checking it in a
  // parameter post-inference (not as a `TData extends …` constraint, which TS
  // rejects as circular, TS2313) is what makes inference survive.
  //
  // Membership form `true extends ContainsSecret<TData>` (556/1), not
  // `ContainsSecret<TData> extends true`: when TData is a union like
  // `{ok:true} | {s:Secret<string>}`, the naked-type-parameter conditional in
  // ContainsSecret DISTRIBUTES over the union, so the result is
  // `false | true` = `boolean`, not the literal `true` — `ContainsSecret<
  // TData> extends true` is then false (boolean isn't assignable to the
  // literal true) and the old check silently fell through to `[]` even with
  // a real leak in one branch. Putting the naked `true` on the LEFT instead
  // keeps the check fail-closed for the union case (`true extends boolean`
  // is true) without eagerly normalizing ContainsSecret<TData> against a
  // literal — which is what blew up TS's instantiation depth on generic
  // call-sites (createTokenRequestHandler's still-unresolved TSuccessKind).
  ..._noSecretInResponse: true extends ContainsSecret<TData>
    ? [
        secretLeak: "A handler response must not contain a Secret<> — call .reveal() and return the plaintext, or drop the field.",
      ]
    : []
): WriteHandlerDefinition<TName, TSchema, TData, TMap, TPrepared, TWhenNested>;
// The implementation sees the grant list as the full EscapeHatchGrant union, so the author's handler
// takes the plain context types; only the overload above hands callers the grant-typed ctx.
export function defineWriteHandler<
  TName extends string,
  TSchema extends ZodType,
  TData,
  TMap extends object,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>,
): WriteHandlerDefinition<TName, TSchema, TData, TMap, TPrepared, TWhenNested> {
  assertSingleHandlerForm(def);
  // Optional fields stay absent instead of `key: undefined` (convention of entity-handlers.ts / define-feature.ts).
  return {
    ...pickWriteHandlerMetadata(def),
    ...pickWriteHandlerSafetyFlags(def),
    ...pickPreTransactionPhases(def),
    handler: compileWriteHandler(def),
    ...(def.perform !== undefined && { perform: def.perform }),
  };
}

function compileQueryHandler<
  TName extends string,
  TSchema extends ZodType,
  TResult,
  TMap extends object,
>(
  def: QueryHandlerInput<TName, TSchema, TResult, TMap>,
): QueryHandlerDefinition<TName, TSchema, TResult, TMap> {
  const readsGranted = escapeHatchAllows(def.escapeHatch, "crossTenantReads");
  if (def.systemScope === true) {
    const { handler, name } = def;
    return {
      ...def,
      handler: async (query, ctx) =>
        handler(query, grantedContext(systemScopeContext(ctx, name), name, readsGranted)),
    };
  }
  if (!readsGranted) return def;
  const { handler, name } = def;
  return {
    ...def,
    handler: async (query, ctx) => handler(query, crossTenantReadsContext(ctx, name)),
  };
}

export function defineQueryHandler<
  const TName extends string,
  TSchema extends ZodType,
  TResult = unknown,
  TMap extends object = KumikoEventTypeMap,
  TGrant extends EscapeHatchGrant = EscapeHatchGrant,
>(
  def: QueryHandlerInput<TName, TSchema, TResult, TMap, TGrant>,
  // R6: phantom rest-param — see defineWriteHandler. Forbids a Secret<> in the
  // inferred query response `TResult` at compile time; `[]` for clean responses.
  // Membership form (556/1) — see defineWriteHandler's comment for why.
  ..._noSecretInResponse: true extends ContainsSecret<TResult>
    ? [
        secretLeak: "A handler response must not contain a Secret<> — call .reveal() and return the plaintext, or drop the field.",
      ]
    : []
): QueryHandlerDefinition<TName, TSchema, TResult, TMap>;
// Implementation signature: see defineWriteHandler.
export function defineQueryHandler<
  TName extends string,
  TSchema extends ZodType,
  TResult,
  TMap extends object,
>(
  def: QueryHandlerInput<TName, TSchema, TResult, TMap>,
): QueryHandlerDefinition<TName, TSchema, TResult, TMap> {
  return compileQueryHandler(def);
}

// Runtime marker set only by definePagedQueryHandler. A plain
// defineQueryHandler-built object never carries it. query-output-columns.ts
// reads it to gate the paged envelope check on outputSchema; the renderer's
// runtime shape guard (kumiko-screen.tsx) remains as a second line.
//
// A string key, not a Symbol: bundled-features imports this module through
// the package's "@cosmicdrift/kumiko-framework/engine" subpath (symlinked
// node_modules entry) via a different resolution route than a same-package
// relative import — two routes to the same file that can end up as two
// separate module instances under bundler symlink handling. A Symbol()
// evaluated twice would produce two unequal brands; a string literal doesn't
// have that failure mode.
// Exported (not just the predicate) so feature-entity-handlers.ts's
// queryHandler() registrar — which rebuilds a fresh QueryHandlerDef from an
// explicit field whitelist rather than spreading `def` — can carry the
// brand through into the stored registry entry.
export const PAGED_QUERY_HANDLER_BRAND = "__kumikoPagedQueryHandler";

export function isPagedQueryHandler(def: object): boolean {
  return propertyOf(def, PAGED_QUERY_HANDLER_BRAND) === true;
}

export function isEntityConventionQueryHandler(def: object): boolean {
  return propertyOf(def, ENTITY_CONVENTION_QUERY_BRAND) === true;
}

export function isEntityConventionWriteHandler(def: object): boolean {
  return propertyOf(def, ENTITY_CONVENTION_WRITE_BRAND) === true;
}

export type PagedQueryHandlerDefinition<
  TName extends string = string,
  TSchema extends ZodType = ZodType,
  TRow = unknown,
  TMap extends object = KumikoEventTypeMap,
> = QueryHandlerDefinition<TName, TSchema, CursorResult<TRow>, TMap> & {
  readonly [PAGED_QUERY_HANDLER_BRAND]: true;
};

// A projectionList screen's query must resolve to { rows, nextCursor, total? }
// (CursorResult<T>) — the renderer used to read rowsQuery.data?.rows and
// silently show an empty list otherwise; the renderer now guards against a
// malformed shape at runtime instead. Use this instead of defineQueryHandler
// for any query wired to a projectionList screen's `query` so the contract is
// documented at the definition site.
//
// Deliberately does NOT merge cursor/limit/sort/search into the input
// schema — that would change sortable/paginated derivation for existing
// screens (a behavior change, not a wrapper change). Callers that want
// those params add them to `schema` themselves.
export function definePagedQueryHandler<
  const TName extends string,
  TSchema extends ZodType,
  TRow = unknown,
  TMap extends object = KumikoEventTypeMap,
  TGrant extends EscapeHatchGrant = EscapeHatchGrant,
>(
  def: QueryHandlerInput<TName, TSchema, CursorResult<TRow>, TMap, TGrant>,
  // R6: phantom rest-param — see defineWriteHandler. CursorResult<TRow> wraps
  // TRow in `rows`, so ContainsSecret recurses through the array element.
  ..._noSecretInResponse: true extends ContainsSecret<CursorResult<TRow>>
    ? [
        secretLeak: "A handler response must not contain a Secret<> — call .reveal() and return the plaintext, or drop the field.",
      ]
    : []
): PagedQueryHandlerDefinition<TName, TSchema, TRow, TMap>;
// Implementation signature: see defineWriteHandler.
export function definePagedQueryHandler<
  TName extends string,
  TSchema extends ZodType,
  TRow,
  TMap extends object,
>(
  def: QueryHandlerInput<TName, TSchema, CursorResult<TRow>, TMap>,
): PagedQueryHandlerDefinition<TName, TSchema, TRow, TMap> {
  return { ...compileQueryHandler(def), [PAGED_QUERY_HANDLER_BRAND]: true };
}
