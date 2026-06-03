// Pure helpers for the `kumiko-schema-check` bin. Kept in src/ (vs. the bin)
// so they are part of the tsc project + unit-testable without importing the
// auto-running CLI.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { composeFeatures } from "./compose-features";

// The generate-script lives under different roots across apps: publicstatus
// uses `drizzle/generate.ts`, the framework's own sample-apps use
// `schema/generate.ts`. Pick whichever exists so a no-arg `bunx
// kumiko-schema-check` works in both layouts; default to `drizzle/` for the
// error message when neither is present.
export function resolveGeneratePath(cwd: string): string {
  const drizzlePath = resolve(cwd, "drizzle/generate.ts");
  const schemaPath = resolve(cwd, "schema/generate.ts");
  if (!existsSync(drizzlePath) && existsSync(schemaPath)) return schemaPath;
  return drizzlePath;
}

// The features composeFeatures auto-prepends in auth-mode (config + user +
// tenant + auth-email-password). Derived from composeFeatures itself so this
// can't drift from the real prepend-list in compose-features.ts.
export function implicitAuthModeFeatureNames(): readonly string[] {
  return composeFeatures([], { includeBundled: true }).map((f) => f.name);
}
