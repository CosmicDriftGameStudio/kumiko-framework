import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderGuardsDoc } from "../_lib/guards-doc";

const dirs: string[] = [];

function makeFramework(options: { readonly rules?: unknown }): string {
  const root = mkdtempSync(join(tmpdir(), "guards-doc-"));
  dirs.push(root);
  mkdirSync(join(root, "packages/guards/src"), { recursive: true });
  writeFileSync(
    join(root, "packages/guards/src/guard-x.ts"),
    "/**\n * X Guard — checks x. More text.\n */\n",
  );
  if (options.rules !== undefined) {
    const presets = join(root, "packages/framework/presets");
    mkdirSync(join(presets, "biome-plugins"), { recursive: true });
    writeFileSync(join(presets, "biome-rules.json"), JSON.stringify(options.rules));
    writeFileSync(
      join(presets, "biome-plugins/a.grit"),
      'register_diagnostic(span=$x, message="First sentence. Second.", severity="error")\n',
    );
  }
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("renderGuardsDoc Biome plugin catalog", () => {
  test("has no plugin section without biome-rules.json", () => {
    expect(renderGuardsDoc(makeFramework({}))).not.toContain("## Biome plugins");
  });

  test("lists one row per plugin with its first sentence and non-negated globs", () => {
    const root = makeFramework({
      rules: {
        plugins: [
          { path: "./biome-plugins/a.grit", includes: ["**/src/**/*.ts", "!**/__tests__/**"] },
          { path: "./biome-plugins/a.grit", includes: ["**/bin/**/*.ts"] },
        ],
      },
    });
    const doc = renderGuardsDoc(root);
    const rows = doc.split("\n").filter((line) => line.startsWith("| `a`"));
    expect(rows).toEqual(["| `a` | First sentence. | `**/src/**/*.ts`, `**/bin/**/*.ts` |"]);
    expect(doc).not.toContain("__tests__");
  });

  test("throws on a plugin entry without path", () => {
    const root = makeFramework({ rules: { plugins: [{ includes: ["**/*.ts"] }] } });
    expect(() => renderGuardsDoc(root)).toThrow(/plugins\[0\]/);
  });
});
