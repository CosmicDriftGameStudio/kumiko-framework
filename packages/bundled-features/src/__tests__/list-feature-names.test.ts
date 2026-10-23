import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_LIST_FEATURE_NAMES } from "../list-feature-names.ts";

const SRC_DIR = join(import.meta.dir, "..");
const NON_FEATURE_DIRS = new Set(["shared", "presets", "__tests__"]);
const LIST_SCREEN_PATTERN = /\btype: "(entityList|projectionList)"|\bkind: "relatedList"/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

// For bundled features the directory name is the feature name.
function directoriesWithListScreens(): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_FEATURE_DIRS.has(entry.name))
    .filter((entry) =>
      sourceFiles(join(SRC_DIR, entry.name)).some((file) =>
        LIST_SCREEN_PATTERN.test(readFileSync(file, "utf8")),
      ),
    )
    .map((entry) => entry.name)
    .sort();
}

describe("BUNDLED_LIST_FEATURE_NAMES", () => {
  test("names exactly the bundled features that ship list screens", () => {
    const declared: readonly string[] = BUNDLED_LIST_FEATURE_NAMES;
    expect([...declared].sort()).toEqual(directoriesWithListScreens());
  });
});
