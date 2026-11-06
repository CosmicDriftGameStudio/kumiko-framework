import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Output } from "../output";

const PRESET_PACKAGE_EXTENDS: ReadonlySet<string> = new Set([
  "@cosmicdrift/kumiko-framework/biome-rules",
  "@cosmicdrift/kumiko-framework/biome",
]);
const PRESET_FILE_SUFFIXES = ["/presets/biome-rules.json", "/presets/biome-app.json"];
const BIOME_CONFIG_NAMES = ["biome.json", "biome.jsonc"];
const PRESET_FIX = '"extends": ["@cosmicdrift/kumiko-framework/biome"]';

function readExtendsList(configPath: string): string[] {
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return [];
  }
  const list =
    typeof parsed === "object" && parsed !== null && "extends" in parsed
      ? parsed.extends
      : undefined;
  const entries = Array.isArray(list) ? list : [list];
  return entries.filter((entry): entry is string => typeof entry === "string");
}

function extendsFrameworkPreset(configPath: string, visited: Set<string>): boolean {
  if (visited.has(configPath)) return false;
  visited.add(configPath);
  return readExtendsList(configPath).some((entry) => {
    if (PRESET_PACKAGE_EXTENDS.has(entry)) return true;
    if (!entry.startsWith(".")) return false;
    const target = resolve(dirname(configPath), entry);
    if (PRESET_FILE_SUFFIXES.some((suffix) => target.endsWith(suffix))) return true;
    return existsSync(target) && extendsFrameworkPreset(target, visited);
  });
}

function repoExtendsFrameworkPreset(repoRoot: string): boolean {
  const configPath = BIOME_CONFIG_NAMES.map((name) => join(repoRoot, name)).find((candidate) =>
    existsSync(candidate),
  );
  return configPath !== undefined && extendsFrameworkPreset(configPath, new Set());
}

function resolveBiomeBin(repoRoot: string): string | undefined {
  try {
    return join(dirname(Bun.resolveSync("@biomejs/biome/package.json", repoRoot)), "bin", "biome");
  } catch {
    return undefined;
  }
}

/** Runs the repo's own Biome so builtin rules and the biome-rules plugins count towards `kumiko check`. */
export async function runLintCheckStep(out: Output, repoRoot: string): Promise<number> {
  const biomeBin = resolveBiomeBin(repoRoot);
  if (biomeBin === undefined) {
    out.err(
      "  ✗ @biomejs/biome is not installed in this repo — kumiko check needs it for the lint step.",
    );
    out.err("    Fix: `bun add -d @biomejs/biome`");
    return 1;
  }
  // Without the preset the SSRF, path-traversal, event-store-write and admin-API plugins are missing and the lint step stays green.
  if (!repoExtendsFrameworkPreset(repoRoot)) {
    out.err(
      "  ✗ biome.json does not extend the Kumiko Biome preset — the security plugins (SSRF, path traversal, event-store writes, admin API) would not run.",
    );
    out.err(`    Fix: add ${PRESET_FIX} to biome.json`);
    return 1;
  }
  const proc = Bun.spawn(["bun", biomeBin, "lint", "."], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  for (const line of `${stdout}${stderr}`.split("\n")) {
    if (line.trim().length > 0) out.log(`    ${line}`);
  }
  return code === 0 ? 0 : 1;
}
