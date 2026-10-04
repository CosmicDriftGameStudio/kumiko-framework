// watchAndRegenerate — file-watcher-Tests. Verifiziert: initial-Pass
// läuft synchron, file-changes triggern einen erneuten Pass mit Debounce,
// close() ist idempotent.
//
// Fixtures liegen wie bei strict-mode-diagnostics.test.ts unter
// `__tests__/.tmp-fixtures/` (gitignored), damit Node's natürliches
// `node_modules`-Hochsuchen 'zod' findet — auch wenn watch-Tests
// 'zod' nicht direct nutzen, runCodegen scant feature-files die
// `import { z } from "zod"` haben.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CodegenResult } from "../run-codegen.js";
import { isCodegenRelevantChange, watchAndRegenerate } from "../watch.js";

const TEST_FIXTURE_DIR = join(__dirname, ".tmp-fixtures");
const createdDirs: string[] = [];

function makeAppDir(): string {
  mkdirSync(TEST_FIXTURE_DIR, { recursive: true });
  const dir = mkdtempSync(join(TEST_FIXTURE_DIR, "watch-"));
  createdDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

afterAll(() => {
  for (const d of createdDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// Native fs events are not used here: macOS FSEvents starts asynchronously and can drop
// writes, so the test drives the watcher's listener directly.
type WatchListener = (eventType: string, filename: string | null) => void;

function fakeWatchDirectory(): {
  readonly watchDirectory: typeof import("node:fs").watch;
  readonly emit: (filename: string) => void;
} {
  let listener: WatchListener | undefined;
  const watchDirectory = ((_dir: string, _options: unknown, onEvent: WatchListener) => {
    listener = onEvent;
    return { close: () => {} };
  }) as unknown as typeof import("node:fs").watch;
  return {
    watchDirectory,
    emit: (filename) => {
      if (!listener) throw new Error("watcher was never attached");
      listener("change", filename);
    },
  };
}

const FEATURE_TEMPLATE = (featureName: string, eventName: string) => `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export default defineFeature("${featureName}", (r) => {
  r.defineEvent("${eventName}", z.object({ id: z.string() }));
});
`;

describe("watchAndRegenerate", () => {
  test("initial run produces output synchronously", () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("billing", "first-event"));

    const results: CodegenResult[] = [];
    const handle = watchAndRegenerate({
      appRoot,
      onResult: (r) => results.push(r),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.eventCount).toBe(1);
    handle.close();
  });

  test("file change triggers a re-run after debounce", async () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("orders", "first"));
    const { watchDirectory, emit } = fakeWatchDirectory();

    const results: CodegenResult[] = [];
    let secondResult: (result: CodegenResult) => void = () => {};
    const secondRun = new Promise<CodegenResult>((resolve) => {
      secondResult = resolve;
    });
    const handle = watchAndRegenerate({
      appRoot,
      debounceMs: 30,
      watchDirectory,
      onResult: (r) => {
        results.push(r);
        if (results.length === 2) secondResult(r);
      },
    });

    try {
      expect(results).toHaveLength(1);
      expect(results[0]?.eventCount).toBe(1);

      writeFile(
        appRoot,
        "src/feature.ts",
        `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export default defineFeature("orders", (r) => {
  r.defineEvent("first", z.object({ id: z.string() }));
  r.defineEvent("second", z.object({ tag: z.string() }));
});
`,
      );
      emit("feature.ts");
      emit("feature.ts");

      expect((await secondRun).eventCount).toBe(2);
      expect(results).toHaveLength(2);
    } finally {
      handle.close();
    }
  });

  test("close() is idempotent", () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("nope", "evt"));
    const handle = watchAndRegenerate({ appRoot, onResult: () => {} });
    handle.close();
    expect(() => handle.close()).not.toThrow();
  });

  // The filter is checked as a pure function: a negative assertion over real
  // fs.watch events is racy, because macOS can deliver an event for a write
  // made before the watcher attached at any later point and inflate the count.
  test("only production .ts/.tsx changes are codegen-relevant", () => {
    const relevant = ["feature.ts", "nested/screen.tsx", "nested\\win.ts"];
    const ignored = [
      "styles.css",
      "README.md",
      "config.json",
      "types.generated.d.ts",
      "feature.test.ts",
      "screen.test.tsx",
      "node_modules/dep/index.ts",
      ".kumiko/out.ts",
      "dist/bundle.ts",
      "dist-server/entry.ts",
      "__tests__/helper.ts",
    ];
    expect(relevant.filter(isCodegenRelevantChange)).toEqual(relevant);
    expect(ignored.filter(isCodegenRelevantChange)).toEqual([]);
  });
});
