// watchAndRegenerate — file-watcher der bei jeder TS-Änderung unter
// `<appRoot>/src/**` `runCodegen` neu fährt. Lebendige IDE-DX: User
// editiert ein r.defineEvent, drückt save, das `.kumiko/types.generated.d.ts`
// ist innerhalb von ~50ms aktualisiert, der TS-Sprachserver merkt es,
// neue Auto-Complete-Vorschläge erscheinen ohne Server-Restart.
//
// Implementation: node:fs.watch (recursive) auf `<appRoot>/src/`.
// Debounced damit ein batch-edit (z.B. find+replace via sed) nicht
// 50× hintereinander feuert. Idempotent — runCodegen schreibt nur bei
// echter Änderung, der Watcher kann ohne Schaden über-ruft werden.
//
// Nicht-Ziele: kein Watcher auf `node_modules`, `.kumiko`, `dist*`,
// `__tests__` (gleicher SKIP-Set wie scan-events). fs.watch's
// recursive-Mode liefert events für jede Subdir; wir filtern im
// Callback.

import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import { runCodegen } from "./run-codegen";

export type WatchOptions = {
  /** App-Wurzel — gleiche Bedeutung wie für `runCodegen`. */
  readonly appRoot: string;
  /** Wartet diese Millisekunden zusätzliche Events ab, bevor codegen
   *  einmal fährt. 50ms catched typische save-bursts (Editor-Saves
   *  feuern oft 2-3 Events: temp-file → rename → cleanup), bleibt aber
   *  unmerklich für den User. */
  readonly debounceMs?: number;
  /** Callback nach jedem erfolgreichen Codegen-Pass. Default: stderr-
   *  Log mit event-count + warnings. Wer den Output strukturiert
   *  konsumieren will (Dev-Server-UI, IDE-Plugin), gibt einen eigenen
   *  Handler. */
  readonly onResult?: (result: ReturnType<typeof runCodegen>) => void;
  /** Callback bei runCodegen-Fehlern. Default: stderr-Warning. */
  readonly onError?: (err: unknown) => void;
};

export type WatchHandle = {
  /** Beendet den Watcher. Idempotent — mehrfacher Aufruf ist no-op. */
  readonly close: () => void;
};

const SKIP_SUBSTRINGS = ["/node_modules/", "/.kumiko/", "/dist/", "/dist-server/", "/__tests__/"];

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Startet den Watcher. Beim Boot fährt einmalig `runCodegen` (sodass
 * die generated Files sofort frisch sind), dann hängt sich an `fs.watch`
 * und re-runs bei file-changes mit Debounce.
 */
export function watchAndRegenerate(opts: WatchOptions): WatchHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const srcDir = join(opts.appRoot, "src");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  let closed = false;

  const fire = () => {
    try {
      const result = runCodegen({ appRoot: opts.appRoot });
      if (opts.onResult) {
        opts.onResult(result);
      } else {
        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            // biome-ignore lint/suspicious/noConsole: codegen-watcher logs to terminal
            console.warn(`[codegen] ${w.file}:${w.line} — ${w.reason}`);
          }
        }
      }
    } catch (err) {
      if (opts.onError) opts.onError(err);
      else {
        // biome-ignore lint/suspicious/noConsole: codegen-watcher logs to terminal
        console.warn(
          `[codegen] regenerate failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  // Initial run — gleiches Verhalten wie wenn ein file-change kam, aber
  // ohne Debounce (User wartet auf den ersten codegen).
  fire();

  try {
    watcher = watch(srcDir, { recursive: true }, (_eventType, filename) => {
      if (closed || !filename) return;
      // node liefert filename relativ zu srcDir, kann aber posix oder
      // windows-style separators haben. Wir prüfen substring-tolerant.
      const normalised = `/${filename.toString().replace(/\\/g, "/")}`;
      if (SKIP_SUBSTRINGS.some((seg) => normalised.includes(seg))) return;
      // Nur .ts/.tsx interessieren — alles andere (CSS, MD, JSON) hat
      // keinen Einfluss auf r.defineEvent-Calls.
      if (!normalised.endsWith(".ts") && !normalised.endsWith(".tsx")) return;
      // .d.ts ausgenommen — die kommen meistens vom codegen selbst.
      if (normalised.endsWith(".d.ts")) return;
      // .test.ts/.test.tsx ausgenommen — Tests definieren keine
      // Production-Features.
      if (normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx")) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
    });
  } catch (err) {
    // Watch failed (z.B. fs nicht recursive-fähig auf Linux ohne
    // patches) — degraded mode: codegen läuft nur beim initial-call.
    // User kriegt keine live-updates, aber das ist nicht fatal.
    if (opts.onError) opts.onError(err);
    else {
      // biome-ignore lint/suspicious/noConsole: codegen-watcher logs to terminal
      console.warn(
        `[codegen] watcher failed to start (live-updates disabled): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}
