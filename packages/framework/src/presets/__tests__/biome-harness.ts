import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as z from "zod";

const PRESETS_DIR = join(import.meta.dir, "..", "..", "..", "presets");
const BIOME_BIN = join(
  dirname(Bun.resolveSync("@biomejs/biome/package.json", import.meta.dir)),
  "bin",
  "biome",
);

const reportSchema = z.object({
  diagnostics: z.array(
    z.object({
      category: z.string(),
      message: z.string(),
      location: z
        .object({
          path: z.string().optional(),
          start: z.object({ line: z.number() }).optional(),
        })
        .optional(),
    }),
  ),
});

// Fixtures write template placeholders as `@{x}` so test files stay clear of noTemplateCurlyInString.
const PLACEHOLDER_OPEN = "@{";
const TEMPLATE_OPEN = "$" + "{";

export type Finding = {
  readonly category: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export function pluginPath(name: string): string {
  return join(PRESETS_DIR, "biome-plugins", `${name}.grit`);
}

export function presetPath(name: string): string {
  return join(PRESETS_DIR, name);
}

export function lintFixture(
  config: Record<string, unknown>,
  files: Readonly<Record<string, string>>,
): Finding[] {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-biome-"));
  try {
    writeFileSync(join(dir, "biome.json"), JSON.stringify({ root: true, ...config }));
    for (const [rel, source] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, source.replaceAll(PLACEHOLDER_OPEN, TEMPLATE_OPEN));
    }
    const result = spawnSync(
      "bun",
      [BIOME_BIN, "lint", "--reporter=json", "--max-diagnostics=none", "."],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    const jsonLine = result.stdout.split("\n").find((line) => line.startsWith('{"summary'));
    if (jsonLine === undefined) {
      throw new Error(`biome produced no JSON report: ${result.stdout}\n${result.stderr}`);
    }
    return reportSchema
      .parse(JSON.parse(jsonLine))
      .diagnostics.filter((d) => d.location?.path !== undefined && d.location.path !== "biome.json")
      .map((d) => ({
        category: d.category,
        file: d.location?.path ?? "",
        line: d.location?.start?.line ?? 0,
        message: d.message,
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function lintWithPlugin(plugin: string, files: Readonly<Record<string, string>>): Finding[] {
  return lintFixture(
    { linter: { enabled: true, rules: { preset: "none" } }, plugins: [pluginPath(plugin)] },
    files,
  ).filter((finding) => finding.category === "plugin");
}

export function lineNumbers(findings: readonly Finding[], file: string): number[] {
  return findings.filter((f) => f.file === file).map((f) => f.line);
}
