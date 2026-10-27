import type { CursorResult } from "@cosmicdrift/kumiko-types/cursor-types";
import type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-types/event-type-map";
import type {
  BeforeTransactionWhenNested,
  WriteEvent,
  WriteResult,
} from "@cosmicdrift/kumiko-types/handlers";
import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type * as z from "zod";
import type { ZodType } from "zod";
import type { ContainsSecret } from "../secrets/types.ts";
import { runPipeline } from "./run-pipeline.ts";
import type {
  QueryHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./types/define-handler.ts";
import type { HandlerContext } from "./types/index.ts";

export type {
  QueryHandlerDefinition,
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

export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
  TPrepared = undefined,
  TWhenNested extends BeforeTransactionWhenNested | undefined = undefined,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap, TPrepared, TWhenNested>,
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
): WriteHandlerDefinition<TName, TSchema, TData, TMap, TPrepared, TWhenNested> {
  // Runtime-guard against accidentally setting BOTH handler+perform.
  // The discriminated-union type-error
  //   "Type 'PipelineDef<...>' is not assignable to type 'undefined'."
  // is functional but cryptic for less TS-experienced users; this throws
  // a name-and-explanation error message instead.
  const handlerName = def.name;
  if (hasHandlerAndPerform(def)) {
    throw new Error(
      `defineWriteHandler("${handlerName}"): both \`handler\` and \`perform\` are set. ` +
        `Pick one — \`handler\` for the free-form async function, ` +
        `\`perform: stepsPipeline(...)\` for the step-pipeline form. ` +
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
    ...(def.description !== undefined && { description: def.description }),
    ...(def.agent && { agent: def.agent }),
    ...(def.unsafeSkipTransitionGuard && { unsafeSkipTransitionGuard: true }),
    ...(def.rateLimit && { rateLimit: def.rateLimit }),
    ...(def.additionalRateLimits && { additionalRateLimits: def.additionalRateLimits }),
    ...(def.rateLimitCost && { rateLimitCost: def.rateLimitCost }),
    ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
    ...pickPreTransactionPhases(def),
    ...(def.tenantlessAnonymous && { tenantlessAnonymous: true }),
    ...(def.transaction && { transaction: def.transaction }),
  };

  if ("perform" in def && def.perform !== undefined) {
    const performDef = def.perform;
    // @wrapper-known semantic-alias
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

export function defineQueryHandler<
  const TName extends string,
  TSchema extends ZodType,
  TResult = unknown,
  TMap extends object = KumikoEventTypeMap,
>(
  def: QueryHandlerDefinition<TName, TSchema, TResult, TMap>,
  // R6: phantom rest-param — see defineWriteHandler. Forbids a Secret<> in the
  // inferred query response `TResult` at compile time; `[]` for clean responses.
  // Membership form (556/1) — see defineWriteHandler's comment for why.
  ..._noSecretInResponse: true extends ContainsSecret<TResult>
    ? [
        secretLeak: "A handler response must not contain a Secret<> — call .reveal() and return the plaintext, or drop the field.",
      ]
    : []
): QueryHandlerDefinition<TName, TSchema, TResult, TMap> {
  return def;
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
>(
  def: QueryHandlerDefinition<TName, TSchema, CursorResult<TRow>, TMap>,
  // R6: phantom rest-param — see defineWriteHandler. CursorResult<TRow> wraps
  // TRow in `rows`, so ContainsSecret recurses through the array element.
  ..._noSecretInResponse: true extends ContainsSecret<CursorResult<TRow>>
    ? [
        secretLeak: "A handler response must not contain a Secret<> — call .reveal() and return the plaintext, or drop the field.",
      ]
    : []
): PagedQueryHandlerDefinition<TName, TSchema, TRow, TMap> {
  return { ...def, [PAGED_QUERY_HANDLER_BRAND]: true };
}
