// =====================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Run `yarn kumiko codegen` to regenerate (or rely on the dev-server's
// file-watcher, which calls it on every r.defineEvent change).
// =====================================================================

// Triple-slash reference pulls the augmentation into this compile-
// unit. Belt-and-suspenders against include-glob variations:
//   - Apps that include `.kumiko/` in tsconfig pick up the .d.ts
//     transitively; the reference is redundant but harmless.
//   - Tooling that compiles a narrow file-set (probes, isolated
//     test programs) typically ignores .d.ts unless explicitly
//     referenced — without this line, the augmentation is invisible
//     and `keyof KumikoEventTypeMap` collapses to `never`. Verified
//     empirically; see strict-mode-diagnostics.test.ts.
// NOT a `import "./types.generated"` side-effect — the file is .d.ts
// (declarations only), runtime tools (Vitest, Bun, Node) can't load
// it. Triple-slash is type-only, fully elided from JS output.
/// <reference path="./types.generated.d.ts" />

// Re-export the entire engine surface — apps can switch their imports
// from `@cosmicdrift/kumiko-framework/engine` to `./.kumiko/define` with a single
// sed-replace, no fine-grained import-splitting needed. The strict
// `defineWriteHandler` / `defineQueryHandler` overrides below shadow
// the loose framework versions in the local module's export table.
export * from "@cosmicdrift/kumiko-framework/engine";

import {
  defineWriteHandler as fwDefineWriteHandler,
  defineQueryHandler as fwDefineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  KumikoEventTypeMap,
  WriteHandlerDefinition,
  WriteHandlerInput,
  QueryHandlerDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ZodType } from "zod";

// Strict defineWriteHandler — TMap fixed to the global
// KumikoEventTypeMap (which the augmentation extends). ctx.appendEvent
// inside the handler resolves K against the FULL augmented map.
export function defineWriteHandler<
  const TName extends string,
  TSchema extends ZodType,
  TData = unknown,
>(
  def: WriteHandlerInput<TName, TSchema, TData, KumikoEventTypeMap>,
): WriteHandlerDefinition<TName, TSchema, TData, KumikoEventTypeMap> {
  return fwDefineWriteHandler<TName, TSchema, TData, KumikoEventTypeMap>(def);
}

export function defineQueryHandler<
  const TName extends string,
  TSchema extends ZodType,
  TResult = unknown,
>(
  def: QueryHandlerDefinition<TName, TSchema, TResult, KumikoEventTypeMap>,
): QueryHandlerDefinition<TName, TSchema, TResult, KumikoEventTypeMap> {
  return fwDefineQueryHandler<TName, TSchema, TResult, KumikoEventTypeMap>(def);
}
