import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Glob } from "bun";
import { Project } from "ts-morph";

// `*ForTests` helpers reach into module-private state — resetPiiSubjectKmsForTests()
// clears the injected KMS, after which encryptForStorage sees no adapter and writes
// subject-annotated fields in plaintext, with no error and no log. They are reachable
// only through the ./testing subpath (#1631); a production barrel must not re-export
// them, or any app can import one by accident.
//
// A runtime NODE_ENV check would be the test hook in production code that this repo's
// convention rules out, and it would fire on call instead of on import. The export
// path is the mechanism, so the export path is what gets guarded.

const REPO = join(import.meta.dir, "..");
const TEST_ONLY_SUFFIX = /ForTests$/;
const TEST_ONLY_SUBPATH = /\/(testing|stack)$/;

// Every published package, not just the two this issue moved symbols out of —
// the same drift is possible anywhere a barrel is edited.
function publishedPackages(): string[] {
  return [...new Glob("*/package.json").scanSync({ cwd: join(REPO, "packages") })]
    .map((p) => dirname(p))
    .sort();
}

interface Barrel {
  readonly pkg: string;
  readonly subpath: string;
  readonly entry: string;
}

function newProject(): Project {
  return new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
}

function productionBarrels(): Barrel[] {
  const barrels: Barrel[] = [];
  for (const pkg of publishedPackages()) {
    const pkgJsonPath = join(REPO, "packages", pkg, "package.json");
    const exportsMap: Record<string, unknown> = JSON.parse(readFileSync(pkgJsonPath, "utf8")).exports ?? {};
    for (const [subpath, target] of Object.entries(exportsMap)) {
      if (TEST_ONLY_SUBPATH.test(subpath)) continue;
      const file =
        typeof target === "string" ? target : (target as { default?: string } | null)?.default;
      if (!file?.endsWith(".ts")) continue;
      barrels.push({ pkg, subpath, entry: join(dirname(pkgJsonPath), file) });
    }
  }
  return barrels;
}

describe("test-only helpers stay out of the production barrels", () => {
  it("finds barrels to check at all", () => {
    // Without this the suite passes vacuously if the exports map ever changes shape.
    expect(productionBarrels().length).toBeGreaterThan(10);
  });

  it("re-exports only named symbols, so the scan below is complete", () => {
    // `export * from "./x"` would smuggle a name past a named-export scan.
    const project = newProject();
    const starExports: string[] = [];
    for (const barrel of productionBarrels()) {
      const source = project.addSourceFileAtPathIfExists(barrel.entry);
      if (!source) continue;
      for (const decl of source.getExportDeclarations()) {
        if (decl.isNamespaceExport()) {
          starExports.push(`${barrel.pkg}${barrel.subpath.slice(1)} → ${decl.getModuleSpecifierValue()}`);
        }
      }
    }
    expect(starExports.sort()).toEqual([]);
  });

  it("exports no *ForTests symbol", () => {
    const project = newProject();
    const offenders: string[] = [];

    for (const barrel of productionBarrels()) {
      const source = project.addSourceFileAtPathIfExists(barrel.entry);
      if (!source) continue;
      const names = [
        ...source.getExportDeclarations().flatMap((d) => d.getNamedExports().map((n) => n.getName())),
        ...[...source.getFullText().matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(
          (m) => m[1] as string,
        ),
      ];
      for (const name of names) {
        if (TEST_ONLY_SUFFIX.test(name)) {
          offenders.push(`${barrel.pkg}${barrel.subpath.slice(1)} → ${name}`);
        }
      }
    }

    expect([...new Set(offenders)].sort()).toEqual([]);
  });
});
