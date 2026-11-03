import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as framework from "@cosmicdrift/kumiko-framework/engine";
import * as featureAst from "../index.ts";
import {
  MOVED_ENGINE_EXPORTS,
  transformFeatureAstPackageSource,
} from "../scripts/codemod/feature-ast-package.ts";
import { transformPackageJson } from "../scripts/codemod/feature-ast-package-manifest.ts";

const FILE = "/repo/apps/demo/src/feature.ts";
const ENGINE = "@cosmicdrift/kumiko-framework/engine";
const NEW = "@cosmicdrift/kumiko-feature-ast";

const run = (source: string) => transformFeatureAstPackageSource(source, FILE);

describe("feature-ast-package codemod: sources", () => {
  it("splits a mixed import and keeps the rest on framework/engine", () => {
    const result = run(`import { defineFeature, parseFeatureFile } from "${ENGINE}";\n`);
    expect(result.output).toBe(
      `import { defineFeature } from "${ENGINE}";\nimport { parseFeatureFile } from "${NEW}";\n`,
    );
    expect(result.rewrites).toHaveLength(1);
  });

  it("only swaps the specifier when every name moved", () => {
    const result = run(`import { parseFeatureFile, renderPattern } from "${ENGINE}";\n`);
    expect(result.output).toBe(`import { parseFeatureFile, renderPattern } from "${NEW}";\n`);
  });

  it("keeps import type, specifier-level type and aliases", () => {
    const typeOnly = run(`import type { ParseResult } from "${ENGINE}";\n`);
    expect(typeOnly.output).toBe(`import type { ParseResult } from "${NEW}";\n`);

    const mixed = run(
      `import { defineFeature, type ParseError, parseFeatureFile as parse } from "${ENGINE}";\n`,
    );
    expect(mixed.output).toContain(`import { defineFeature } from "${ENGINE}";`);
    expect(mixed.output).toContain(
      `import { type ParseError, parseFeatureFile as parse } from "${NEW}";`,
    );
  });

  it("splits an export-from declaration", () => {
    const result = run(`export { defineFeature, PATTERN_LIBRARY } from "${ENGINE}";\n`);
    expect(result.output).toContain(`export { defineFeature } from "${ENGINE}";`);
    expect(result.output).toContain(`export { PATTERN_LIBRARY } from "${NEW}";`);
  });

  it("moves the engine/codemod subpath for import, export-from and dynamic import", () => {
    const old = `${ENGINE}/codemod`;
    const result = run(
      `import { x } from "${old}";\nexport { y } from "${old}";\nconst m = await import("${old}");\n`,
    );
    expect(result.output).toBe(
      `import { x } from "${NEW}/codemod";\nexport { y } from "${NEW}/codemod";\nconst m = await import("${NEW}/codemod");\n`,
    );
    expect(result.rewrites).toHaveLength(3);
  });

  it("reports a namespace import that reads a moved name as manual", () => {
    const source = `import * as engine from "${ENGINE}";\nengine.parseFeatureFile("x");\n`;
    const result = run(source);
    expect(result.output).toBe(source);
    expect(result.manual).toHaveLength(1);
    expect(result.rewrites).toHaveLength(0);
  });

  it.each([
    ["element access", `engine["parseFeatureFile"]("x");`],
    ["destructuring", `const { parseFeatureFile: parse } = engine;`],
  ])("reports a namespace import read through %s as manual", (_form, usage) => {
    const source = `import * as engine from "${ENGINE}";\n${usage}\n`;
    const result = run(source);
    expect(result.output).toBe(source);
    expect(result.manual).toHaveLength(1);
  });

  it("reports export * from the old module as manual", () => {
    const source = `export * from "${ENGINE}";\n`;
    const result = run(source);
    expect(result.output).toBe(source);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.description).toContain("export *");
  });

  it("leaves export * as ns and named re-exports of unmoved names alone", () => {
    const source = `export * as engine from "${ENGINE}";\nexport { defineFeature } from "${ENGINE}";\n`;
    expect(run(source)).toMatchObject({ output: source, manual: [], rewrites: [] });
  });

  it.each([
    ["dynamic import", `const { parseFeatureFile } = await import("${ENGINE}");\n`],
    ["import type", `type Parsed = import("${ENGINE}").ParseResult;\n`],
  ])("reports a %s of the old module as manual", (_form, source) => {
    const result = run(source);
    expect(result.output).toBe(source);
    expect(result.manual).toHaveLength(1);
  });

  it("leaves a namespace import alone when it reads no moved name", () => {
    const source = `import * as engine from "${ENGINE}";\nengine.defineFeature("x");\n`;
    expect(run(source)).toMatchObject({ output: source, manual: [], rewrites: [] });
  });

  it("is idempotent", () => {
    const first = run(`import { defineFeature, parseFeatureFile } from "${ENGINE}";\n`);
    const second = run(first.output);
    expect(second.output).toBe(first.output);
    expect(second.rewrites).toHaveLength(0);
  });
});

describe("feature-ast-package codemod: package.json", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "feature-ast-package-"));
    mkdirSync(join(dir, "src"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const manifest = (block: Record<string, string>, indent = 2) =>
    `${JSON.stringify({ name: "app", dependencies: block }, null, indent)}\n`;
  const transform = (manifestText: string) => {
    const path = join(dir, "package.json");
    writeFileSync(path, manifestText);
    return transformFeatureAstPackageSource(manifestText, path);
  };

  it("adds feature-ast with framework's range, sorted, once the sources use the moved API", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${ENGINE}";\n`);
    const result = transform(
      manifest({ "@cosmicdrift/kumiko-framework": "^0.389.0", zod: "^4.0.0" }),
    );
    expect(JSON.parse(result.output).dependencies).toEqual({
      "@cosmicdrift/kumiko-feature-ast": "^0.389.0",
      "@cosmicdrift/kumiko-framework": "^0.389.0",
      zod: "^4.0.0",
    });
    expect(Object.keys(JSON.parse(result.output).dependencies)).toEqual([
      "@cosmicdrift/kumiko-feature-ast",
      "@cosmicdrift/kumiko-framework",
      "zod",
    ]);
  });

  it("detects the already migrated import so file order does not matter", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${NEW}";\n`);
    const result = transform(manifest({ "@cosmicdrift/kumiko-framework": "^0.389.0" }));
    expect(result.rewrites).toHaveLength(1);
  });

  it("adds nothing when no source uses the moved API", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { defineFeature } from "${ENGINE}";\n`);
    const text = manifest({ "@cosmicdrift/kumiko-framework": "^0.389.0" });
    expect(transform(text).output).toBe(text);
  });

  it("ignores sources in node_modules and nested packages", () => {
    mkdirSync(join(dir, "node_modules/x"), { recursive: true });
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested/package.json"), "{}");
    const used = `import { parseFeatureFile } from "${ENGINE}";\n`;
    writeFileSync(join(dir, "node_modules/x/a.ts"), used);
    writeFileSync(join(dir, "nested/a.ts"), used);
    const text = manifest({ "@cosmicdrift/kumiko-framework": "^0.389.0" });
    expect(transform(text).output).toBe(text);
  });

  it("does not add a second entry", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${NEW}";\n`);
    const text = manifest({
      "@cosmicdrift/kumiko-feature-ast": "^0.389.0",
      "@cosmicdrift/kumiko-framework": "^0.389.0",
    });
    expect(transform(text).output).toBe(text);
  });

  it("does not walk the sources of a package that already declares feature-ast or lacks framework", () => {
    let probed = 0;
    const countingProbe = () => {
      probed += 1;
      return true;
    };
    const path = join(dir, "package.json");
    for (const block of [
      { "@cosmicdrift/kumiko-feature-ast": "^1.0.0", "@cosmicdrift/kumiko-framework": "^1.0.0" },
      { zod: "^4.0.0" },
    ]) {
      const text = manifest(block);
      expect(transformPackageJson(text, path, { rewrites: [], manual: [] }, countingProbe)).toBe(
        text,
      );
    }
    expect(probed).toBe(0);
  });

  it("keeps the indent and appends when the block was not sorted", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${ENGINE}";\n`);
    const result = transform(
      manifest({ zod: "^4.0.0", "@cosmicdrift/kumiko-framework": "^1.0.0" }, 4),
    );
    expect(result.output).toContain('\n    "name"');
    expect(Object.keys(JSON.parse(result.output).dependencies)).toEqual([
      "zod",
      "@cosmicdrift/kumiko-framework",
      "@cosmicdrift/kumiko-feature-ast",
    ]);
  });

  it("uses devDependencies when framework is declared there", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${ENGINE}";\n`);
    const text = `${JSON.stringify({ devDependencies: { "@cosmicdrift/kumiko-framework": "^1.0.0" } }, null, 2)}\n`;
    expect(JSON.parse(transform(text).output).devDependencies).toEqual({
      "@cosmicdrift/kumiko-feature-ast": "^1.0.0",
      "@cosmicdrift/kumiko-framework": "^1.0.0",
    });
  });

  it("adds the entry to devDependencies and peerDependencies with each block's own range", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${ENGINE}";\n`);
    const text = `${JSON.stringify(
      {
        devDependencies: { "@cosmicdrift/kumiko-framework": "0.389.0" },
        peerDependencies: { "@cosmicdrift/kumiko-framework": ">=0.389.0 <1.0.0" },
      },
      null,
      2,
    )}\n`;
    const out = JSON.parse(transform(text).output);
    expect(out.devDependencies[NEW]).toBe("0.389.0");
    expect(out.peerDependencies[NEW]).toBe(">=0.389.0 <1.0.0");
    expect(out.dependencies).toBeUndefined();
  });

  it("mirrors an optional framework peer", () => {
    writeFileSync(join(dir, "src/a.ts"), `import { parseFeatureFile } from "${ENGINE}";\n`);
    const text = `${JSON.stringify(
      {
        peerDependencies: { "@cosmicdrift/kumiko-framework": "^1.0.0" },
        peerDependenciesMeta: { "@cosmicdrift/kumiko-framework": { optional: true } },
      },
      null,
      2,
    )}\n`;
    expect(JSON.parse(transform(text).output).peerDependenciesMeta[NEW]).toEqual({
      optional: true,
    });
  });
});

describe("feature-ast-package codemod: moved names", () => {
  const VALUE_NAMES = MOVED_ENGINE_EXPORTS.filter((name) => /^[a-z]|^[A-Z_]+$/.test(name));

  it("lists 36 names", () => {
    expect(MOVED_ENGINE_EXPORTS).toHaveLength(36);
    expect(VALUE_NAMES).toHaveLength(15);
  });

  it("exports every moved value from feature-ast and no longer from framework/engine", () => {
    for (const name of VALUE_NAMES) {
      expect(name in featureAst).toBe(true);
      expect(name in framework).toBe(false);
    }
  });
});
