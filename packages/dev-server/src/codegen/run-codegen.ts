// runCodegen — Top-Level Entry-Point. Wird vom Dev-Server (auf Boot),
// vom Build-Step (vor Bundle) und von der CLI (`yarn kumiko codegen`)
// aufgerufen.
//
// Lifecycle:
//   1. Scan `<appRoot>/src/**` nach r.defineEvent.
//   2. Render bis zu drei Files unter `<appRoot>/.kumiko/`:
//        - types.generated.d.ts  (immer wenn Events oder bestehende Datei)
//        - schemas.generated.ts  (nur wenn ≥1 inline-Schema)
//        - define.ts             (immer)
//   3. Schreibe nur bei tatsächlicher Änderung — sonst kein touch
//      (TS-Sprachserver bleibt cached, Watcher feuert nicht).
//   4. Wenn 0 Events UND noch kein .kumiko/ existiert: bail. Apps die
//      `r.defineEvent` nicht nutzen brauchen keinen Wrapper-Pfad und
//      kein leeres Verzeichnis.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDefineFile, renderInlineSchemasFile, renderTypesAugmentation } from "./render";
import { type ScanWarning, scanEvents } from "./scan-events";

export type CodegenOptions = {
  /** App-Root — `<appRoot>/.kumiko/` ist der Output-Ordner. */
  readonly appRoot: string;
};

export type CodegenResult = {
  readonly outputDir: string;
  readonly eventCount: number;
  readonly warnings: readonly ScanWarning[];
  readonly didWriteTypes: boolean;
  readonly didWriteSchemas: boolean;
  readonly didWriteDefine: boolean;
  readonly skipped: boolean;
};

export function runCodegen(opts: CodegenOptions): CodegenResult {
  const outputDir = join(opts.appRoot, ".kumiko");
  const outputExists = existsSync(outputDir);

  const scan = scanEvents({ appRoot: opts.appRoot });

  const typesPath = join(outputDir, "types.generated.d.ts");
  const definePath = join(outputDir, "define.ts");
  const schemasPath = join(outputDir, "schemas.generated.ts");
  const packageJsonPath = join(outputDir, "package.json");

  // Skip-Pfad: keine Events gefunden + keine bestehende Output-Dir
  // bedeutet die App nutzt r.defineEvent nicht (oder noch nicht). Kein
  // leeres `.kumiko/` zurücklassen — das hilft niemandem und produziert
  // false-positives in CI ("eh, was ist denn das hier"). Wenn die Dir
  // schon existiert (alter Run), generieren wir trotzdem — ein Refactor
  // der den letzten r.defineEvent löscht soll das Output dann auch
  // bereinigen, statt eine stale Augmentation liegen zu lassen.
  if (scan.events.length === 0 && !outputExists) {
    return {
      outputDir,
      eventCount: 0,
      warnings: scan.warnings,
      didWriteTypes: false,
      didWriteSchemas: false,
      didWriteDefine: false,
      skipped: true,
    };
  }

  mkdirSync(outputDir, { recursive: true });

  const typesContent = renderTypesAugmentation(scan.events, outputDir);
  const defineContent = renderDefineFile();
  const schemasContent = renderInlineSchemasFile(scan.events);
  // package.json — turns `.kumiko/` into a real installable package
  // named `@app/define`. Apps that declare
  //   "@app/define": "link:./.kumiko"
  // in their package.json get a node_modules symlink that the runtime
  // (Node, Vitest, Bun) all resolve via standard module-lookup. Yarn 4
  // is required — yarn classic v1 ignored deps in versionless workspaces.
  const packageJsonContent = renderKumikoPackageJson();

  const didWriteTypes = writeIfChanged(typesPath, typesContent);
  const didWriteDefine = writeIfChanged(definePath, defineContent);
  writeIfChanged(packageJsonPath, packageJsonContent);
  const didWriteSchemas =
    schemasContent !== undefined
      ? writeIfChanged(schemasPath, schemasContent)
      : removeIfExists(schemasPath);

  return {
    outputDir,
    eventCount: scan.events.length,
    warnings: scan.warnings,
    didWriteTypes,
    didWriteSchemas,
    didWriteDefine,
    skipped: false,
  };
}

/**
 * Static package.json content — turns `.kumiko/` into an installable
 * package called `@app/define`. The shape never depends on event-scans,
 * so we don't bother passing the events in.
 *
 * Two things to keep stable:
 *   - `name: "@app/define"` matches what handler imports use.
 *   - `exports."."` points at the wrapper, `exports."./*"` lets apps
 *     reach into types.generated etc. via `@app/types.generated`.
 */
function renderKumikoPackageJson(): string {
  const pkg = {
    name: "@app/define",
    private: true,
    // license: keep the generated package out of unknown-license territory
    // for the License-Check guard. The repo is BUSL-1.1-licensed, the generated
    // wrapper inherits that — the file just re-exports framework code,
    // there's no original IP in `.kumiko/` worth a different license.
    license: "BUSL-1.1",
    version: "0.0.0",
    type: "module",
    main: "./define.ts",
    types: "./define.ts",
    exports: {
      ".": "./define.ts",
      "./*": "./*",
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * Idempotent write — only touches the file when its content actually
 * changed. Critical for the dev-server watcher: a no-op codegen pass
 * must NOT trigger a full TS-language-server rebuild (which would
 * happen on every mtime change).
 */
function writeIfChanged(path: string, content: string): boolean {
  let existing: string | undefined;
  try {
    existing = readFileSync(path, "utf-8");
  } catch {
    existing = undefined;
  }
  if (existing === content) return false;
  writeFileSync(path, content, "utf-8");
  return true;
}

/**
 * Remove a previously-generated file when the latest scan no longer
 * produces it (e.g. the last inline-schema was refactored to a named
 * export). Returns true when an actual unlink happened.
 */
function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
