import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { guard } from "../guard-cross-feature-imports";

// The guard resolves feature boundaries against `path.relative(process.cwd(),
// absPath)`. ts-morph's in-memory filesystem anchors bare relative paths at
// "/" instead of cwd, which would produce a "../../.."-prefixed relative
// path that never matches the guard's feature-boundary regexes — so every
// in-memory path here is joined onto process.cwd() to land where the guard
// expects it.
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

const featureB = {
  "packages/bundled-features/src/b/index.ts": "export const barrel = 1;",
  "packages/bundled-features/src/b/contract.ts": "export type Contract = { id: string };",
  "packages/bundled-features/src/b/schema/entity.ts": 'export const entity = { name: "b" };',
  "packages/bundled-features/src/b/feature.ts": 'export const feature = { name: "b" };',
  "packages/bundled-features/src/b/lib/sync.ts": "export function sync() {}",
};

describe("Cross-Feature-Import Guard", () => {
  test("allows the barrel import", () => {
    const sfs = files({
      ...featureB,
      "packages/bundled-features/src/a/feature.ts": `
					import { barrel } from "../b";
					export const a = barrel;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("allows importing the contract module (public surface)", () => {
    const sfs = files({
      ...featureB,
      "packages/bundled-features/src/a/feature.ts": `
					import type { Contract } from "../b/contract";
					export const a: Contract | undefined = undefined;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("allows importing schema/entity (public surface)", () => {
    const sfs = files({
      ...featureB,
      "packages/bundled-features/src/a/feature.ts": `
					import { entity } from "../b/schema/entity";
					export const a = entity;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("blocks importing another feature's registration module (feature.ts) directly", () => {
    const sfs = files({
      ...featureB,
      "packages/bundled-features/src/a/feature.ts": `
					import { feature } from "../b/feature";
					export const a = feature;
				`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("../b/feature");
  });

  test("blocks a deep lib import", () => {
    const sfs = files({
      ...featureB,
      "packages/bundled-features/src/a/feature.ts": `
					import { sync } from "../b/lib/sync";
					export const a = sync;
				`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("../b/lib/sync");
  });

  test("same-feature relative imports stay unrestricted", () => {
    const sfs = files({
      "packages/bundled-features/src/a/feature.ts": `
					import { helper } from "./helper";
					export const a = helper;
				`,
      "packages/bundled-features/src/a/helper.ts": "export const helper = 1;",
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("non-relative imports stay unrestricted", () => {
    const sfs = files({
      "packages/bundled-features/src/a/feature.ts": `
					import { z } from "zod";
					export const a = z;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });
});
