import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformScaffoldKmsModeSource } from "../scripts/codemod/scaffold-kms-mode.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "scaffold-kms-mode");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const MAIN_FILE = "/app/bin/main.ts";
const CLI_FILE = "/app/bin/kumiko.ts";

const SCAFFOLDS = [
  { name: "demo main", file: MAIN_FILE, old: "old-demo-main.txt", current: "new-demo-main.txt" },
  { name: "blank main", file: MAIN_FILE, old: "old-blank-main.txt", current: "new-blank-main.txt" },
  { name: "kumiko cli", file: CLI_FILE, old: "old-kumiko.txt", current: "new-kumiko.txt" },
] as const;

describe("scaffold-kms-mode codemod", () => {
  for (const scaffold of SCAFFOLDS) {
    it(`${scaffold.name}: old scaffold becomes the current scaffold, a second run is a no-op`, () => {
      const first = transformScaffoldKmsModeSource(fixture(scaffold.old), scaffold.file);
      expect(first.output).toBe(fixture(scaffold.current));
      expect(first.rewrites.length).toBeGreaterThan(0);
      expect(first.manual).toEqual([]);

      const second = transformScaffoldKmsModeSource(first.output, scaffold.file);
      expect(second.output).toBe(first.output);
      expect(second.rewrites).toEqual([]);
      expect(second.manual).toEqual([]);
    });
  }

  it("leaves a hand-edited bin/main.ts untouched and reports it", () => {
    const edited = fixture("old-demo-main.txt").replace(
      "requireKmsWiring(process.env, kmsOpts)",
      "requireKmsWiring({ ...process.env }, kmsOpts)",
    );
    const result = transformScaffoldKmsModeSource(edited, MAIN_FILE);
    expect(result.output).toBe(edited);
    expect(result.rewrites).toEqual([]);
    expect(result.manual.length).toBeGreaterThan(0);
  });

  it("leaves bin/main.ts alone when requireKmsWiring is used a second time", () => {
    const edited = `${fixture("old-demo-main.txt")}\nrequireKmsWiring(process.env, kmsOpts);\n`;
    const result = transformScaffoldKmsModeSource(edited, MAIN_FILE);
    expect(result.output).toBe(edited);
    expect(result.manual.length).toBeGreaterThan(0);
  });

  it("leaves a hand-edited bin/kumiko.ts untouched and reports it", () => {
    const edited = fixture("old-kumiko.txt").replace(
      "kmsSlotsOf(envSchema.schema)",
      "kmsSlotsOf(envSchema.schema).filter(Boolean)",
    );
    const result = transformScaffoldKmsModeSource(edited, CLI_FILE);
    expect(result.output).toBe(edited);
    expect(result.rewrites).toEqual([]);
    expect(result.manual.length).toBeGreaterThan(0);
  });

  it("reports a bin/kumiko.ts whose kmsSlotsOf call is not the scaffold initializer", () => {
    const edited = `import { kmsSlotsOf } from "@cosmicdrift/kumiko-framework/env";\nconst slots = kmsSlotsOf(env.schema);\n`;
    const result = transformScaffoldKmsModeSource(edited, CLI_FILE);
    expect(result.output).toBe(edited);
    expect(result.manual.length).toBeGreaterThan(0);
  });

  it("ignores other files with the same content", () => {
    const source = fixture("old-demo-main.txt");
    const result = transformScaffoldKmsModeSource(source, "/app/src/other.ts");
    expect(result.output).toBe(source);
    expect(result.manual).toEqual([]);
  });
});
