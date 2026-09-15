import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { guard } from "../guard-restricted-symbols";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

describe("Restricted-Symbols Guard", () => {
  test("flags an import of a restricted symbol outside the allowlist", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
					import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
					void getUnscopedAggregateStreamMaxVersion;
				`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("getUnscopedAggregateStreamMaxVersion");
  });

  test("flags a renamed import (alias does not evade the guard)", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
					import { getUnscopedAggregateStreamTenant as sneaky } from "@cosmicdrift/kumiko-framework/event-store";
					void sneaky;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags a re-export of a restricted symbol", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/wrapper.ts": `
					export { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("allows the event-store definition + re-export files", () => {
    const sfs = files({
      "packages/framework/src/event-store/index.ts": `
					export { getUnscopedAggregateStreamMaxVersion, getUnscopedAggregateStreamTenant } from "./event-store";
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("allows the documented seed/tier-engine callers", () => {
    const sfs = files({
      "packages/bundled-features/src/tenant/seeding.ts": `
					import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
					void getUnscopedAggregateStreamMaxVersion;
				`,
      "packages/bundled-features/src/tier-engine/feature.ts": `
					import { getUnscopedAggregateStreamMaxVersion } from "@cosmicdrift/kumiko-framework/event-store";
					void getUnscopedAggregateStreamMaxVersion;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("ignores unrelated named imports", () => {
    const sfs = files({
      "packages/bundled-features/src/foo/feature.ts": `
					import { getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
					void getStreamVersion;
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("a nested packages/ segment is not treated as the repo root, so the allowlist does not apply", () => {
    const sfs = files({
      "packages/cosmicdriftgamestudio/packages/framework/src/event-store/index.ts": `
					export { getUnscopedAggregateStreamMaxVersion, getUnscopedAggregateStreamTenant } from "./event-store";
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(2);
  });

  test("flags a namespace-import property access", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
					import * as es from "@cosmicdrift/kumiko-framework/event-store";
					void es.getUnscopedAggregateStreamMaxVersion();
				`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });
});
