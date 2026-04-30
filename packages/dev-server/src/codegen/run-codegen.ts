// runCodegen — Top-Level Entry-Point. Wird vom Dev-Server (per
// File-Watcher), vom Build-Step (vor Bundle) und von der CLI
// (`yarn kumiko codegen`) aufgerufen.
//
// Lifecycle:
//   1. Scan `<appRoot>/src/**` (+ extra paths) nach r.defineEvent.
//   2. Render types.generated.d.ts + define.ts (Idempotent).
//   3. Schreibe nur bei tatsächlicher Änderung — sonst kein touch
//      (TS-Sprachserver bleibt cached, Watcher feuert nicht).
//
// Output: ein Result mit Counts + Warnings, sodass Dev-Server / Build /
// CLI je eigene Reports rendern können (stderr, log, JSON).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDefineFile, renderTypesAugmentation } from "./render";
import { type ScanWarning, scanEvents } from "./scan-events";

export type CodegenOptions = {
  /** App-Root — `<appRoot>/.kumiko/` ist der Output-Ordner. */
  readonly appRoot: string;
  /** Zusätzlich zu `<appRoot>/src` zu scannende Verzeichnisse. Nützlich
   *  für Monorepo-Setups: z.B. eine Demo-App will die Events aus den
   *  bundled-features mit augmentieren. Pfade absolut. */
  readonly extraScanPaths?: readonly string[];
};

export type CodegenResult = {
  readonly outputDir: string;
  readonly eventCount: number;
  readonly warnings: readonly ScanWarning[];
  readonly didWriteTypes: boolean;
  readonly didWriteDefine: boolean;
};

export function runCodegen(opts: CodegenOptions): CodegenResult {
  const outputDir = join(opts.appRoot, ".kumiko");
  mkdirSync(outputDir, { recursive: true });

  const scan = scanEvents({
    appRoot: opts.appRoot,
    ...(opts.extraScanPaths ? { extraScanPaths: opts.extraScanPaths } : {}),
  });

  const typesPath = join(outputDir, "types.generated.d.ts");
  const definePath = join(outputDir, "define.ts");

  const typesContent = renderTypesAugmentation(scan.events, outputDir);
  const defineContent = renderDefineFile();

  const didWriteTypes = writeIfChanged(typesPath, typesContent);
  const didWriteDefine = writeIfChanged(definePath, defineContent);

  return {
    outputDir,
    eventCount: scan.events.length,
    warnings: scan.warnings,
    didWriteTypes,
    didWriteDefine,
  };
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
