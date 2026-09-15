import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoManifest } from "@cosmicdrift/kumiko-repo-manifest";
import type { RepoRoot } from "../_lib/roots";

export type RepoLayout = "flat" | "packages" | { readonly manifest: RepoManifest };

function defaultManifestFor(layout: "flat" | "packages"): RepoManifest {
  return layout === "flat"
    ? {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
      }
    : {
        kind: "library",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.{test,integration}.{ts,tsx}"],
      };
}

// A literal stand-in for the `*` wildcard segment — just needs to be a real
// directory so the seeded source file is reachable through the pattern.
function seedDirFor(sourceRootPattern: string): string {
  return sourceRootPattern
    .split("/")
    .map((segment) => (segment === "*" ? "pkg" : segment))
    .join("/");
}

// Writes package.json + bun.lock plus one real .ts file per declared sourceRoot, so the fixture is never an empty scan root by accident; `layout: { manifest }` also writes that manifest as kumiko.json.
export function writeRepo(
  dir: string,
  opts: { readonly name: string; readonly layout: RepoLayout },
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: opts.name }), "utf-8");
  writeFileSync(join(dir, "bun.lock"), "{}", "utf-8");
  const manifest =
    typeof opts.layout === "object" ? opts.layout.manifest : defaultManifestFor(opts.layout);
  if (typeof opts.layout === "object") {
    writeFileSync(join(dir, "kumiko.json"), JSON.stringify(manifest, null, 2), "utf-8");
  }
  for (const sourceRoot of manifest.sourceRoots) {
    const seedDir = join(dir, seedDirFor(sourceRoot));
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, "index.ts"), "export {};\n", "utf-8");
  }
}

// A RepoRoot literal for tests that inject `roots` directly, bypassing the git/package.json-walk fallbacks so a fixture never escapes into the real checkout tree.
export function fixtureRoot(name: string, absPath: string, manifest: RepoManifest): RepoRoot {
  return { name, absPath, kind: manifest.kind, manifest, manifestSource: "file" };
}
