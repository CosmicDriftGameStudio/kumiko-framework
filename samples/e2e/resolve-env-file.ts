import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** First existing .env: monorepo parent, then framework repo root. */
export function resolveSamplesEnvFile(fromDir: string): string | undefined {
  for (const rel of ["../../../../.env", "../../../.env"]) {
    const path = resolve(fromDir, rel);
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function samplesEnvFileArg(fromDir: string): string {
  const path = resolveSamplesEnvFile(fromDir);
  return path ? `--env-file=${path}` : "";
}
