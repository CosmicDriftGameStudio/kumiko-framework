// Unit tests for the runtime-isolation classifier's path-pattern table.
//
// These tests exist because the path-pattern bugs are silent — a regex
// that doesn't match doesn't throw, it just classifies the file as
// `runtime` (the default), and the import-graph check waves through
// imports that should have been blocked.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import {
  classify,
  classifyByPath,
  computeClientReachablePaths,
  findRuntimeIsolationViolations,
  isClientEntryPath,
  isValueImport,
} from "../runtime-isolation-classify";

describe("classifyByPath — test-runtime patterns", () => {
  test("matches __tests__ directory anywhere in the path", () => {
    expect(classifyByPath("packages/framework/src/__tests__/foo.ts")).toBe("test");
  });

  test("matches testing/ directory anywhere in the path", () => {
    expect(classifyByPath("packages/framework/src/testing/helpers.ts")).toBe("test");
  });

  test("matches a file literally named testing.ts", () => {
    expect(classifyByPath("packages/framework/src/testing.ts")).toBe("test");
  });

  test("matches *.test.ts", () => {
    expect(classifyByPath("packages/framework/src/foo.test.ts")).toBe("test");
  });

  test("matches *.integration.ts", () => {
    expect(classifyByPath("samples/recipes/x/y.integration.ts")).toBe("test");
  });

  test("matches *.e2e.tsx", () => {
    expect(classifyByPath("samples/apps/foo.e2e.tsx")).toBe("test");
  });
});

describe("classifyByPath — tooling-runtime patterns", () => {
  test("matches scripts/ at the repo root (the historic regression)", () => {
    // The corrected pattern uses `(?:^|\/)scripts\/` instead of `\/scripts\/`,
    // which silently missed scripts/foo.ts at depth 0.
    expect(classifyByPath("scripts/check-runtime-isolation.ts")).toBe("tooling");
  });

  test("matches scripts/ nested inside a workspace", () => {
    expect(classifyByPath("packages/framework/scripts/seed.ts")).toBe("tooling");
  });

  test("matches bin/ at the repo root", () => {
    expect(classifyByPath("bin/main.ts")).toBe("tooling");
  });

  test("matches bin/ nested inside a workspace", () => {
    expect(classifyByPath("samples/showcases/publicstatus/bin/main.ts")).toBe("tooling");
  });

  test("matches drizzle/<file>.ts but only direct children of drizzle/", () => {
    expect(classifyByPath("samples/showcases/publicstatus/drizzle/0001_init.ts")).toBe("tooling");
  });

  test("matches drizzle.config.ts at any depth", () => {
    expect(classifyByPath("samples/showcases/publicstatus/drizzle.config.ts")).toBe("tooling");
  });
});

describe("classifyByPath — non-matches fall through to null", () => {
  test("a plain runtime source file under packages/", () => {
    expect(classifyByPath("packages/framework/src/api/server.ts")).toBeNull();
  });

  test("a sample app shell that isn't bin/ or scripts/", () => {
    expect(classifyByPath("samples/recipes/basic-entity/src/feature.ts")).toBeNull();
  });

  test("does NOT match a file that just happens to contain the word 'scripts'", () => {
    expect(classifyByPath("packages/framework/scripts-helpers.ts")).toBeNull();
  });

  test("does NOT match an arbitrary file inside drizzle subdir tree", () => {
    expect(classifyByPath("samples/showcases/publicstatus/drizzle/meta/journal.json")).toBeNull();
  });

  test("normalizes Windows backslashes before matching", () => {
    expect(classifyByPath("scripts\\foo.ts")).toBe("tooling");
  });
});

describe("classifyByPath — client-safe carve-outs", () => {
  test("a web.ts file at any depth is client", () => {
    expect(classifyByPath("packages/locale-de/src/web.ts")).toBe("client");
    expect(classifyByPath("packages/bundled-features/src/page-render/web.ts")).toBe("client");
  });

  test("a web/ directory at any depth is client", () => {
    expect(classifyByPath("packages/bundled-features/src/user-profile/web/index.ts")).toBe(
      "client",
    );
  });

  test("does NOT match a file merely containing 'web' without a path segment boundary", () => {
    expect(classifyByPath("packages/framework/src/webhook/index.ts")).toBeNull();
  });

  test("framework's time/utils/engine-types/errors subpaths are client", () => {
    expect(classifyByPath("packages/framework/src/time/index.ts")).toBe("client");
    expect(classifyByPath("packages/framework/src/utils/index.ts")).toBe("client");
    expect(classifyByPath("packages/framework/src/engine/types/index.ts")).toBe("client");
    expect(classifyByPath("packages/framework/src/errors/index.ts")).toBe("client");
  });

  test("does NOT extend the isomorphic carve-out to another package's utils/", () => {
    expect(classifyByPath("packages/some-other-package/src/utils/index.ts")).toBeNull();
  });

  test("does NOT extend it to framework's own engine/ (only engine/types/)", () => {
    expect(classifyByPath("packages/framework/src/engine/index.ts")).toBeNull();
  });

  test("locale-de/es strings.ts is client", () => {
    expect(classifyByPath("packages/locale-de/src/strings.ts")).toBe("client");
    expect(classifyByPath("packages/locale-es/src/strings.ts")).toBe("client");
  });

  test("dev-server env-schema.ts is client", () => {
    expect(classifyByPath("packages/dev-server/src/env-schema.ts")).toBe("client");
  });

  test("does NOT carve out dev-server's other files (e.g. compose-stacks.ts)", () => {
    expect(classifyByPath("packages/dev-server/src/compose-stacks.ts")).toBeNull();
  });
});

describe("isClientEntryPath — mirrors kumiko-build's discoverClientEntries", () => {
  test("matches the single-entry convention", () => {
    expect(isClientEntryPath("src/client.tsx")).toBe(true);
    expect(isClientEntryPath("src/client.ts")).toBe(true);
  });

  test("matches the multi-entry convention", () => {
    expect(isClientEntryPath("src/client-admin.tsx")).toBe(true);
    expect(isClientEntryPath("src/client-public.ts")).toBe(true);
  });

  test("rejects a nested src/ (only the repo-root entry counts)", () => {
    expect(isClientEntryPath("src/app/client-admin.tsx")).toBe(false);
  });

  test("rejects a file that merely starts with 'client'", () => {
    expect(isClientEntryPath("src/client-features.ts")).toBe(true);
    expect(isClientEntryPath("src/clientHelpers.ts")).toBe(false);
  });

  test("rejects an uppercase suffix (discoverClientEntries requires [a-z])", () => {
    expect(isClientEntryPath("src/client-Admin.tsx")).toBe(false);
  });
});

function makeInMemoryProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  for (const [path, source] of Object.entries(files)) {
    project.createSourceFile(path, source);
  }
  return project;
}

describe("isValueImport", () => {
  test("a plain named import carries runtime weight", () => {
    const project = makeInMemoryProject({
      "/repo/target.ts": "export const x = 1;",
      "/repo/src.ts": 'import { x } from "./target";\nexport const y = x;',
    });
    const [decl] = project.getSourceFileOrThrow("/repo/src.ts").getImportDeclarations();
    expect(decl && isValueImport(decl)).toBe(true);
  });

  test("`import type` is stripped by verbatimModuleSyntax — no runtime weight", () => {
    const project = makeInMemoryProject({
      "/repo/target.ts": "export type X = number;",
      "/repo/src.ts": 'import type { X } from "./target";\nexport const y: X = 1;',
    });
    const [decl] = project.getSourceFileOrThrow("/repo/src.ts").getImportDeclarations();
    expect(decl && isValueImport(decl)).toBe(false);
  });

  test("named imports that are all type-only, with no default/namespace import, carry no weight", () => {
    const project = makeInMemoryProject({
      "/repo/target.ts": "export type X = number;\nexport const y = 1;",
      "/repo/src.ts": 'import { type X } from "./target";\nexport const z: X = 1;',
    });
    const [decl] = project.getSourceFileOrThrow("/repo/src.ts").getImportDeclarations();
    expect(decl && isValueImport(decl)).toBe(false);
  });
});

describe("computeClientReachablePaths", () => {
  test("follows value-import edges transitively from an entry", () => {
    const project = makeInMemoryProject({
      "/repo/src/client.tsx": 'import { helper } from "./helper";\nexport const x = helper;',
      "/repo/src/helper.ts": 'import { deep } from "./deep";\nexport const helper = deep;',
      "/repo/src/deep.ts": "export const deep = 1;",
      "/repo/src/unrelated.ts": "export const unrelated = 1;",
    });
    const isEntry = (sf: SourceFile) => isClientEntryPath(relative("/repo", sf.getFilePath()));
    const reachable = computeClientReachablePaths(project.getSourceFiles(), isEntry);
    expect(reachable.has("/repo/src/client.tsx")).toBe(true);
    expect(reachable.has("/repo/src/helper.ts")).toBe(true);
    expect(reachable.has("/repo/src/deep.ts")).toBe(true);
    expect(reachable.has("/repo/src/unrelated.ts")).toBe(false);
  });

  test("does not cross an `import type` edge", () => {
    const project = makeInMemoryProject({
      "/repo/src/client.tsx": 'import type { Deep } from "./deep";\nexport const x: Deep = 1;',
      "/repo/src/deep.ts": "export type Deep = number;",
    });
    const isEntry = (sf: SourceFile) => isClientEntryPath(relative("/repo", sf.getFilePath()));
    const reachable = computeClientReachablePaths(project.getSourceFiles(), isEntry);
    expect(reachable.has("/repo/src/client.tsx")).toBe(true);
    expect(reachable.has("/repo/src/deep.ts")).toBe(false);
  });

  test("no entries → empty reachable set (repos without a client bundle stay untouched)", () => {
    const project = makeInMemoryProject({ "/repo/src/handler.ts": "export const handler = 1;" });
    const isEntry = (sf: SourceFile) => isClientEntryPath(relative("/repo", sf.getFilePath()));
    const reachable = computeClientReachablePaths(project.getSourceFiles(), isEntry);
    expect(reachable.size).toBe(0);
  });
});

describe("classify — client-reachability layer", () => {
  test("promotes an otherwise-unclassified reachable file to 'client'", () => {
    const cache = new Map();
    const reachable = new Set(["/nonexistent/app/src/helper.ts"]);
    expect(classify("/nonexistent/app/src/helper.ts", "/nonexistent/app", cache, reachable)).toBe(
      "client",
    );
  });

  test("without reachability, the same file stays the 'runtime' default", () => {
    const cache = new Map();
    expect(classify("/nonexistent/app/src/helper.ts", "/nonexistent/app", cache)).toBe("runtime");
  });

  test("a path-pattern match (test/tooling) wins over reachability", () => {
    const cache = new Map();
    const reachable = new Set(["/nonexistent/app/src/__tests__/helper.test.ts"]);
    expect(
      classify(
        "/nonexistent/app/src/__tests__/helper.test.ts",
        "/nonexistent/app",
        cache,
        reachable,
      ),
    ).toBe("test");
  });
});

// End-to-end, single repo root (the public package only ever scans the repo
// it runs in): a plain repo-root helper, several hops from `src/client.tsx`,
// value-imports a package explicitly marked "runtime" via its package.json
// `kumiko.runtime`. Uses real temp files because `classify()`'s directive/
// workspace layers read from the real filesystem, not ts-morph's in-memory one.
describe("findRuntimeIsolationViolations — client bundle reaching a server module", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
  });

  function workspace(): { root: string } {
    const root = mkdtempSync(join(tmpdir(), "kumiko-runtime-isolation-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "packages/framework/src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app" }), "utf-8");
    writeFileSync(
      join(root, "packages/framework/package.json"),
      JSON.stringify({ name: "framework", kumiko: { runtime: "runtime" } }),
      "utf-8",
    );
    return { root };
  }

  function buildProject(root: string, helperImport: string): { files: SourceFile[] } {
    writeFileSync(
      join(root, "src/client.tsx"),
      'import { helper } from "./helper";\nexport const x = helper;\n',
      "utf-8",
    );
    writeFileSync(join(root, "src/helper.ts"), helperImport, "utf-8");
    writeFileSync(
      join(root, "packages/framework/src/engine.ts"),
      "export const engineFn = () => 1;\n",
      "utf-8",
    );
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const files = [
      project.addSourceFileAtPath(join(root, "src/client.tsx")),
      project.addSourceFileAtPath(join(root, "src/helper.ts")),
      project.addSourceFileAtPath(join(root, "packages/framework/src/engine.ts")),
    ];
    return { files };
  }

  function isEntry(root: string): (sf: SourceFile) => boolean {
    return (sf: SourceFile) => isClientEntryPath(relative(root, sf.getFilePath()));
  }

  test("a value-import chain from a client entry into a 'runtime'-marked module is a violation", () => {
    const { root } = workspace();
    const { files } = buildProject(
      root,
      'import { engineFn } from "../packages/framework/src/engine";\nexport const helper = engineFn;\n',
    );
    const reachable = computeClientReachablePaths(files, isEntry(root));
    const { violations } = findRuntimeIsolationViolations(files, root, new Map(), reachable);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(join(root, "src/helper.ts"));
    expect(violations[0]?.fileRuntime).toBe("client");
    expect(violations[0]?.importedRuntime).toBe("runtime");
  });

  test("the same chain via `import type` is not a violation", () => {
    const { root } = workspace();
    const { files } = buildProject(
      root,
      'import type { engineFn } from "../packages/framework/src/engine";\nexport type Helper = typeof engineFn;\n',
    );
    const reachable = computeClientReachablePaths(files, isEntry(root));
    const { violations } = findRuntimeIsolationViolations(files, root, new Map(), reachable);
    expect(violations).toHaveLength(0);
  });
});
