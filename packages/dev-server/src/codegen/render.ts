// Renders the three generated files under `<appRoot>/.kumiko/`:
//
//   1. `types.generated.d.ts` — augments `KumikoEventTypeMap` with every
//      `r.defineEvent` entry. Pure declarations, no runtime code.
//
//   2. `schemas.generated.ts` — re-exports of inline zod schemas, one
//      per `r.defineEvent("name", z.object({...}))` call that wasn't
//      already an imported named export. This file is referenced
//      EXCLUSIVELY via `import type` (in types.generated.d.ts) — the
//      ts-typescript-strip pass elides it at build time, no runtime
//      duplication. Only emitted when at least one inline schema exists.
//
//   3. `define.ts` — the local `defineWriteHandler` /
//      `defineQueryHandler` wrappers that pin TMap explicitly. THIS is
//      where strict mode actually takes effect (see project_x1_typemap_
//      findings memory): cross-package generic functions with the
//      default TMap do NOT see the augmentation — only a local wrapper
//      with an explicit TMap gets it.
//
// All three files are written idempotently — same inputs ⇒ same string.
// The codegen run compares new vs existing content and only writes on
// actual change, so mtime doesn't tick and the TS language server
// doesn't reload every 100ms.

import { basename, relative } from "node:path";
import type { ScannedEvent } from "./scan-events";
import { rewriteImportPath } from "./scan-events";

const HEADER = [
  "// =====================================================================",
  "// AUTO-GENERATED — DO NOT EDIT BY HAND",
  "// Run `bun kumiko codegen` to regenerate (or rely on the dev-server's",
  "// file-watcher, which calls it on every r.defineEvent change).",
  "// =====================================================================",
].join("\n");

/**
 * Render `types.generated.d.ts`. Imports the schema-identifiers as
 * type-only — sources can be either named exports of feature-events
 * files (kind: "imported") or extracted const-exports of the
 * co-generated schemas.generated.ts (kind: "inline"). Result is wired
 * via `z.infer<typeof X>` into the augmentation. Empty events list →
 * minimal but valid file (still augmentable, just no entries yet —
 * useful first-time scaffold).
 */
export function renderTypesAugmentation(
  events: readonly ScannedEvent[],
  outputDirAbs: string,
): string {
  // Group identifiers by their resolved (rewritten) module path so each
  // schema file imports once. Multiple events sharing the same events.ts
  // file is the common case for the "imported" kind. Inline-events all
  // share the same module path: "./schemas.generated".
  const importsByPath = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.schemaSource.kind === "imported") {
      const rewritten = rewriteImportPath(
        ev.schemaSource.schemaModulePath,
        ev.featureFilePath,
        outputDirAbs,
      );
      if (!importsByPath.has(rewritten)) importsByPath.set(rewritten, new Set());
      importsByPath.get(rewritten)?.add(ev.schemaSource.schemaIdentifier);
    } else {
      const path = "./schemas.generated";
      if (!importsByPath.has(path)) importsByPath.set(path, new Set());
      importsByPath.get(path)?.add(ev.schemaSource.generatedConstName);
    }
  }

  const importLines: string[] = [];
  // `z` from zod is needed for `z.infer<typeof X>`; we import it once.
  importLines.push(`import type { z } from "zod";`);
  // Stable order — sort module paths alphabetically; identifiers within
  // a module also alphabetically. Idempotent output.
  for (const [modPath, idents] of [...importsByPath.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sortedIdents = [...idents].sort();
    importLines.push(`import type { ${sortedIdents.join(", ")} } from "${modPath}";`);
  }

  const mapEntries = [...events]
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
    .map((ev) => {
      const refName =
        ev.schemaSource.kind === "imported"
          ? ev.schemaSource.schemaIdentifier
          : ev.schemaSource.generatedConstName;
      return `    "${ev.qualifiedName}": z.infer<typeof ${refName}>;`;
    });

  // Body block — `declare module` in module-form (because we have an
  // `export {}` at the end). Module-form makes the augmentation merge
  // into the target interface; a script-form (`export {}` removed)
  // would REPLACE the module's exports.
  const body = [
    'declare module "@cosmicdrift/kumiko-framework/engine" {',
    "  interface KumikoEventTypeMap {",
    ...(mapEntries.length === 0 ? ["    // (no r.defineEvent calls discovered yet)"] : mapEntries),
    "  }",
    "}",
    "",
    "export {};",
    "",
  ].join("\n");

  return [HEADER, "", ...importLines, "", body].join("\n");
}

/**
 * Render `schemas.generated.ts`. One `export const` per inline-schema
 * event, named via the qualifiedName-derived stable identifier. The
 * source-text of the original `z.*(...)` expression is replayed — we
 * don't try to be cleverer than the zod compiler about reconstructing
 * the schema. Returns undefined when no inline-schemas exist (so the
 * runner can skip writing the file entirely).
 */
export function renderInlineSchemasFile(
  events: readonly ScannedEvent[],
  appRootAbs: string,
): string | undefined {
  const inlines = events.filter((ev) => ev.schemaSource.kind === "inline");
  if (inlines.length === 0) return undefined;

  const lines: string[] = [
    HEADER,
    "",
    "// Schema extracts purely for type inference: this file is referenced",
    "// from types.generated.d.ts via `import type`. ts-strip elides it at",
    "// build time, so there is NO runtime duplication of the inline schemas",
    "// in feature files. When an event schema changes: re-run `bun kumiko",
    "// codegen` — otherwise the z.infer type drifts from the runtime schema.",
    "",
    `import { z } from "zod";`,
    "",
  ];
  // Sort by const-name for stable output.
  const sorted = [...inlines].sort((a, b) => {
    const aName = a.schemaSource.kind === "inline" ? a.schemaSource.generatedConstName : "";
    const bName = b.schemaSource.kind === "inline" ? b.schemaSource.generatedConstName : "";
    return aName.localeCompare(bName);
  });
  for (const ev of sorted) {
    if (ev.schemaSource.kind !== "inline") continue;
    const rel = relative(appRootAbs, ev.featureFilePath).split("\\").join("/");
    // Feature files outside the app root (e.g. a bundled dependency) yield a
    // `../../..`-walk that clutters the source comment; fall back to the bare
    // filename. Comment-only — the generated schema is unaffected.
    const sourcePath = rel.startsWith("..") ? basename(ev.featureFilePath) : rel;
    lines.push(
      `// ${ev.qualifiedName} — from ${sourcePath}:${ev.source.line}`,
      `export const ${ev.schemaSource.generatedConstName} = ${ev.schemaSource.schemaSource};`,
      "",
    );
  }
  return lines.join("\n");
}

/**
 * Render `define.ts` — local thin wrappers that fix TMap to
 * KumikoEventTypeMap. Apps import `defineWriteHandler` /
 * `defineQueryHandler` from this file; framework's strict-overload
 * becomes the only matching overload because TMap is no longer the
 * eager-resolved default.
 *
 * The wrappers are intentionally *thin* — same signature as the
 * framework's, just with TMap pre-bound. Apps stay portable: switch
 * the import back to "@cosmicdrift/kumiko-framework/engine" and you're back on the
 * loose default. Migration is reversible, no behavioural surface change.
 */
export function renderDefineFile(): string {
  const body = [
    HEADER,
    "",
    "// Triple-slash reference pulls the augmentation into this compile-",
    "// unit. Belt-and-suspenders against include-glob variations:",
    "//   - Apps that include `.kumiko/` in tsconfig pick up the .d.ts",
    "//     transitively; the reference is redundant but harmless.",
    "//   - Tooling that compiles a narrow file-set (probes, isolated",
    "//     test programs) typically ignores .d.ts unless explicitly",
    "//     referenced — without this line, the augmentation is invisible",
    "//     and `keyof KumikoEventTypeMap` collapses to `never`. Verified",
    "//     empirically; see strict-mode-diagnostics.test.ts.",
    '// NOT a `import "./types.generated"` side-effect — the file is .d.ts',
    "// (declarations only), runtime tools (Vitest, Bun, Node) can't load",
    "// it. Triple-slash is type-only, fully elided from JS output.",
    `/// <reference path="./types.generated.d.ts" />`,
    "",
    "// Re-export the entire engine surface — apps can switch their imports",
    "// from `@cosmicdrift/kumiko-framework/engine` to `./.kumiko/define` with a single",
    "// sed-replace, no fine-grained import-splitting needed. The strict",
    "// `defineWriteHandler` / `defineQueryHandler` overrides below shadow",
    "// the loose framework versions in the local module's export table.",
    `export * from "@cosmicdrift/kumiko-framework/engine";`,
    "",
    `import {`,
    `  defineWriteHandler as fwDefineWriteHandler,`,
    `  defineQueryHandler as fwDefineQueryHandler,`,
    `} from "@cosmicdrift/kumiko-framework/engine";`,
    `import type {`,
    `  KumikoEventTypeMap,`,
    `  WriteHandlerDefinition,`,
    `  WriteHandlerInput,`,
    `  QueryHandlerDefinition,`,
    `} from "@cosmicdrift/kumiko-framework/engine";`,
    `import type { ZodType } from "zod";`,
    "",
    `// Strict defineWriteHandler — TMap fixed to the global`,
    `// KumikoEventTypeMap (which the augmentation extends). ctx.appendEvent`,
    `// inside the handler resolves K against the FULL augmented map.`,
    `export function defineWriteHandler<`,
    `  const TName extends string,`,
    `  TSchema extends ZodType,`,
    `  TData = unknown,`,
    `>(`,
    `  def: WriteHandlerInput<TName, TSchema, TData, KumikoEventTypeMap>,`,
    `): WriteHandlerDefinition<TName, TSchema, TData, KumikoEventTypeMap> {`,
    `  return fwDefineWriteHandler<TName, TSchema, TData, KumikoEventTypeMap>(def);`,
    `}`,
    "",
    `export function defineQueryHandler<`,
    `  const TName extends string,`,
    `  TSchema extends ZodType,`,
    `  TResult = unknown,`,
    `>(`,
    `  def: QueryHandlerDefinition<TName, TSchema, TResult, KumikoEventTypeMap>,`,
    `): QueryHandlerDefinition<TName, TSchema, TResult, KumikoEventTypeMap> {`,
    `  return fwDefineQueryHandler<TName, TSchema, TResult, KumikoEventTypeMap>(def);`,
    `}`,
    "",
  ].join("\n");

  return body;
}

/**
 * Render `WriteHandlerQn` type lines — exports a union of all registered
 * write handler QNs so custom-screen code can type-check dispatcher.write
 * calls at compile time:
 *
 *   ```ts
 *   import type { WriteHandlerQn } from "@app/define";
 *   dispatcher.write<WriteHandlerQn>("tenant:write:create", payload);  // ✓
 *   dispatcher.write<WriteHandlerQn>("tenant:write:creat", payload);   // ✗ TS error
 *   ```
 */
export function renderWriteHandlerTypes(handlerQns: readonly string[]): string {
  if (handlerQns.length === 0) return "";

  const lines = handlerQns.map((qn) => `  | "${qn}"`);
  return [
    "",
    `export type WriteHandlerQn =`,
    ...lines,
    ";",
    "",
  ].join("\n");
}
