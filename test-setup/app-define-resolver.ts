// Resolves `@app/define` for sample apps during root integration runs.
// Each recipe declares `"@app/define": "file:./.kumiko"` — hoisted installs
// do not link those per-app packages, so we map imports to `.kumiko/define.ts`
// based on the nearest package.json that declares the dependency.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { plugin } from "bun";

const APP_DEFINE = "@app/define";

function resolveAppDefineFromImporter(importer: string): string | undefined {
  let dir = dirname(importer);
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          dependencies?: Record<string, string>;
        };
        const definePath = join(dir, ".kumiko", "define.ts");
        if (pkg.dependencies?.[APP_DEFINE] && existsSync(definePath)) {
          return resolve(definePath);
        }
      } catch {
        // ignore malformed package.json
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

plugin({
  name: "integration-app-define",
  setup(build) {
    build.onResolve({ filter: /^@app\/define$/ }, (args) => {
      const path = resolveAppDefineFromImporter(args.importer);
      if (path) return { path };
    });
  },
});
