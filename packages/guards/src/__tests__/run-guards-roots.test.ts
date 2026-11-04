import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project } from "ts-morph";
import { runGuards } from "../_lib/guard-kit";
import type { RepoRoot } from "../_lib/roots";
import type { RootScan } from "../_lib/scan-scope";
import { guard as internalSubpathImports } from "../guard-internal-subpath-imports";
import { fixtureRoot } from "./parent-workspace-fixture";

const siblingSolon: RepoRoot = fixtureRoot("solon", "/private/tmp/claude-501/scratchpad/wt/solon", {
  kind: "app",
  sourceRoots: ["src"],
  testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
});

const internalImportFile = join(siblingSolon.absPath, "src/rogue/other.ts");

function projectWithFixtureFiles(): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  project.createSourceFile(
    internalImportFile,
    `
      import { anything } from "@cosmicdrift/kumiko-framework/internal/testing";
      void anything;
    `,
  );
  return project;
}

const scanInternalImportFile = (): readonly RootScan[] => [
  { root: siblingSolon, files: [internalImportFile], sourceSurface: 1 },
];

describe("runGuards: roots reach guard.run() for a nonstandard sibling root", () => {
  test("a parent run with a sibling outside the standard layout keeps findings attributable", () => {
    const results = runGuards([internalSubpathImports], projectWithFixtureFiles(), {
      roots: [siblingSolon],
      scan: scanInternalImportFile,
    });

    const internalImportResult = results.find((r) => r.name === internalSubpathImports.name);

    expect(internalImportResult?.error).toBeUndefined();

    expect(internalImportResult?.outcome?.violations).toHaveLength(1);
    expect(internalImportResult?.outcome?.violations[0]?.file).toBe("src/rogue/other.ts");
  });
});
