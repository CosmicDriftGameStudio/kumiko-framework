// Renderer für die drei generierten Files unter `<appRoot>/.kumiko/`:
//
//   1. `types.generated.d.ts` — augmentet `KumikoEventTypeMap` mit allen
//      `r.defineEvent`-Einträgen. Pure declarations, kein runtime code.
//
//   2. `schemas.generated.ts` — re-exports der inline-zod-schemas, einer
//      pro `r.defineEvent("name", z.object({...}))`-Aufruf der nicht
//      schon ein imported named-export war. Diese Datei wird AUSSCHLIESSLICH
//      via `import type` referenziert (in types.generated.d.ts) — der
//      ts-typescript-strip elidiert sie zur Build-Zeit, kein Runtime-Dup.
//      Existiert nur wenn es mindestens ein inline-Schema gibt.
//
//   3. `define.ts` — die lokalen `defineWriteHandler` /
//      `defineQueryHandler` Wrapper, die die TMap explizit fixieren.
//      DAS ist der Punkt an dem der strict-mode aktiv wird (siehe
//      project_x1_typemap_findings memory): cross-package generic-fns
//      mit default-TMap erkennen die Augmentation NICHT — nur ein
//      lokaler Wrapper mit explicit-TMap kriegt es hin.
//
// Alle drei Files werden idempotent geschrieben — gleiche Inputs ⇒
// gleicher String. Der Codegen-Run vergleicht den neuen Inhalt mit dem
// existierenden und schreibt nur bei tatsächlicher Änderung. Damit
// tickt das mtime nicht durch und der TS-Sprachserver muss nicht alle
// 100ms neu laden.

import type { ScannedEvent } from "./scan-events";
import { rewriteImportPath } from "./scan-events";

const HEADER = [
  "// =====================================================================",
  "// AUTO-GENERATED — DO NOT EDIT BY HAND",
  "// Run `yarn kumiko codegen` to regenerate (or rely on the dev-server's",
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
    'declare module "@kumiko/framework/engine" {',
    "  interface KumikoEventTypeMap {",
    ...(mapEntries.length === 0
      ? ["    // (no r.defineEvent calls discovered yet)"]
      : mapEntries),
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
export function renderInlineSchemasFile(events: readonly ScannedEvent[]): string | undefined {
  const inlines = events.filter((ev) => ev.schemaSource.kind === "inline");
  if (inlines.length === 0) return undefined;

  const lines: string[] = [
    HEADER,
    "",
    "// Schema-extracts ausschliesslich für Type-Inferenz: dieses File wird in",
    "// types.generated.d.ts via `import type` referenziert. ts-strip elidiert",
    "// das beim Build, daher KEIN runtime-Dup mit den inline-Schemas in den",
    "// feature-Files. Wenn ein Event-Schema sich ändert: `yarn kumiko codegen`",
    "// neu laufen lassen — sonst driftet der z.infer-Type vom Runtime-Schema.",
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
    lines.push(
      `// ${ev.qualifiedName} — from ${ev.featureFilePath}:${ev.source.line}`,
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
 * the import back to "@kumiko/framework/engine" and you're back on the
 * loose default. Migration is reversible, no behavioural surface change.
 */
export function renderDefineFile(): string {
  const body = [
    HEADER,
    "",
    "// Side-effect import: pulls the augmentation into this compile-unit.",
    "// Without it the strict-overload would still see the augmented map at",
    "// the app's tsc-pass (the .d.ts is included via tsconfig anyway), but",
    "// importing it here makes the linkage explicit + survives partial",
    "// builds where the generated d.ts hasn't been re-emitted yet.",
    `import "./types.generated";`,
    "",
    "// Re-export the entire engine surface — apps can switch their imports",
    "// from `@kumiko/framework/engine` to `./.kumiko/define` with a single",
    "// sed-replace, no fine-grained import-splitting needed. The strict",
    "// `defineWriteHandler` / `defineQueryHandler` overrides below shadow",
    "// the loose framework versions in the local module's export table.",
    `export * from "@kumiko/framework/engine";`,
    "",
    `import {`,
    `  defineWriteHandler as fwDefineWriteHandler,`,
    `  defineQueryHandler as fwDefineQueryHandler,`,
    `} from "@kumiko/framework/engine";`,
    `import type {`,
    `  KumikoEventTypeMap,`,
    `  WriteHandlerDefinition,`,
    `  QueryHandlerDefinition,`,
    `} from "@kumiko/framework/engine";`,
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
    `  def: WriteHandlerDefinition<TName, TSchema, TData, KumikoEventTypeMap>,`,
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
