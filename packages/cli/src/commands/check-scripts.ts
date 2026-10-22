import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import type { Output } from "../output";

type ManagedFilesModule = typeof import("@cosmicdrift/kumiko-dev-server/managed-files");

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function readScripts(repoRoot: string): Record<string, string> {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) throw new Error(`${path} not found`);
  const raw = parseJsonOrThrow<unknown>(readFileSync(path, "utf-8"), path);
  const scripts = typeof raw === "object" && raw !== null && "scripts" in raw ? raw.scripts : {};
  if (!isStringRecord(scripts)) throw new Error(`${path}: "scripts" must map names to strings`);
  return scripts;
}

export async function runScriptsCheckStep(
  out: Output,
  repoRoot: string,
  uiRoots: readonly string[],
): Promise<number> {
  const managed: ManagedFilesModule = await import("@cosmicdrift/kumiko-dev-server/managed-files");
  const adopted = managed.readStaticAppConfig(repoRoot).kind === "defined";
  let scripts: Record<string, string>;
  try {
    scripts = readScripts(repoRoot);
  } catch (error) {
    if (adopted) throw error;
    out.log(`    ! ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  const report = managed.checkAppScripts(scripts, { hasUi: uiRoots.length > 0 });
  if (report.knownExtras.length > 0)
    out.log(`    extras (standard): ${report.knownExtras.join(", ")}`);
  if (report.appExtras.length > 0) out.log(`    extras (app): ${report.appExtras.join(", ")}`);
  if (report.missing.length === 0) {
    out.log("    all standard scripts present");
    return 0;
  }
  out.log(`    ${adopted ? "✗" : "!"} missing standard scripts: ${report.missing.join(", ")}`);
  if (!adopted) {
    out.log("    kumiko.config.ts does not call defineAppConfig yet, so this is a warning.");
    return 0;
  }
  return 1;
}
