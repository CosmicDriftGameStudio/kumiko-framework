import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { guard } from "../guard-write-handler-qns";

// The guard resolves the repo root against `process.cwd()` via
// `resolveRepoRoots()` and reads `feature-manifest.json` straight off disk —
// so in-memory source files must be anchored at real repo-relative paths for
// the manifest-subtree matching to see them (same pattern as
// guard-cross-feature-imports.test.ts).
function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) {
    project.createSourceFile(join(process.cwd(), p), src);
  }
  return project.getSourceFiles();
}

const unknownQnSrc = `
  dispatcher.write("totally-fake-feature:write:nonexistent-handler", {});
`;

describe("Write-Handler-QN Guard — manifest subtree isolation", () => {
  test("flags an unknown QN inside the use-all-bundled manifest subtree", () => {
    const sfs = files({
      "samples/apps/use-all-bundled/src/some-screen.tsx": unknownQnSrc,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("totally-fake-feature:write:nonexistent-handler");
  });

  test("does not flag an unknown QN in a sample app outside the manifest subtree", () => {
    const sfs = files({
      "samples/apps/styleguide/src/features/content/web-test-fixture.tsx": unknownQnSrc,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(0);
  });
});
