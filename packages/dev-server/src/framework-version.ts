import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

const DEV_SERVER_PACKAGE = "@cosmicdrift/kumiko-dev-server";

interface DevServerManifest {
  readonly name: typeof DEV_SERVER_PACKAGE;
  readonly version: string;
}

function isDevServerManifest(value: unknown): value is DevServerManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    value.name === DEV_SERVER_PACKAGE &&
    "version" in value &&
    typeof value.version === "string" &&
    value.version !== ""
  );
}

// All @cosmicdrift packages release in lockstep (changesets fixed-group), so
// the dev-server's own version is the framework version.
export function resolveFrameworkVersion(startDir: string = import.meta.dir): string | undefined {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      // A corrupt or foreign package.json on the way up must not abort the search.
      const manifest = parseJsonSafe<unknown>(readFileSync(candidate, "utf-8"), undefined);
      if (isDevServerManifest(manifest)) return `^${manifest.version}`;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
