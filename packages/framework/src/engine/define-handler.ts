import type { ZodType, z } from "zod";
import type { ContainsSecret } from "../secrets/types";
import { runPipeline } from "./run-pipeline";
import type { HandlerContext, KumikoEventTypeMap, WriteEvent, WriteResult } from "./types";
import type {
  QueryHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./types/define-handler";

export type {
  QueryHandlerDefinition,
  StreamHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./types/define-handler";

export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
  TMap extends object = KumikoEventTypeMap,
>(
  def: WriteHandlerInput<TName, TSchema, TData, TMap>,
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
    ...(def.unsafeSkipTransitionGuard && {
      unsafeSkipTransitionGuard: def.unsafeSkipTransitionGuard,
    }),
    ...(def.rateLimit && { rateLimit: def.rateLimit }),
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
