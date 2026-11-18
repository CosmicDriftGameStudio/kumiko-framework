import { dirname, join } from "node:path";
import { BIOME_PRESET_FIX, repoExtendsFrameworkPreset } from "@cosmicdrift/kumiko-guards";
import type { Output } from "../output";

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
    out.err(`    Fix: add ${BIOME_PRESET_FIX} to biome.json`);
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
