import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTypeAwareProject } from "../scripts/codemod/type-aware-project.ts";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeFakeZod(dir: string, version: string, marker: string): void {
  writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "zod",
      version,
      exports: {
        ".": { types: "./index.d.ts" },
        "./v4/core": { types: "./v4/core.d.ts" },
      },
    }),
  );
  writeFile(join(dir, "index.d.ts"), `export declare const marker: "${marker}";\n`);
  writeFile(join(dir, "v4/core.d.ts"), `export declare const coreMarker: "${marker}";\n`);
}

// A package that nests its own zod, the way bun installs a framework package whose zod range the
// app's pinned zod does not satisfy.
function createAppLayout(options: { readonly withAppZod: boolean }): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "type-aware-project-")));
  roots.push(root);
  writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        noEmit: true,
        types: [],
      },
    }),
  );
  if (options.withAppZod) writeFakeZod(join(root, "node_modules/zod"), "4.6.6", "app");
  const lib = join(root, "node_modules/schema-lib");
  writeFile(
    join(lib, "package.json"),
    JSON.stringify({ name: "schema-lib", version: "1.0.0", types: "./index.d.ts" }),
  );
  writeFile(
    join(lib, "index.d.ts"),
    'export { marker } from "zod";\nexport { coreMarker } from "zod/v4/core";\n',
  );
  writeFakeZod(join(lib, "node_modules/zod"), "4.6.7", "nested");
  writeFile(
    join(root, "src/app.ts"),
    'import { coreMarker, marker } from "schema-lib";\nexport const fromLib = marker;\nexport const coreFromLib = coreMarker;\n',
  );
  return root;
}

function analyse(root: string) {
  const project = createTypeAwareProject(join(root, "tsconfig.json"));
  const app = project.addSourceFileAtPath(join(root, "src/app.ts"));
  const zodDirs = new Set(
    project
      .getProgram()
      .compilerObject.getSourceFiles()
      .map((file) => /^(.*\/node_modules\/zod)\//.exec(file.fileName)?.[1])
      .filter((dir) => dir !== undefined),
  );
  return {
    zodDirs: [...zodDirs],
    fromLib: app.getVariableDeclarationOrThrow("fromLib").getType().getText(),
    coreFromLib: app.getVariableDeclarationOrThrow("coreFromLib").getType().getText(),
  };
}

describe("createTypeAwareProject", () => {
  it("type checks every zod import against the app's zod when a package nests another version", () => {
    const root = createAppLayout({ withAppZod: true });
    const result = analyse(root);
    expect(result.zodDirs).toEqual([join(root, "node_modules/zod")]);
    expect(result.fromLib).toBe('"app"');
    expect(result.coreFromLib).toBe('"app"');
  });

  it("keeps the package's own zod when the app root has none", () => {
    const root = createAppLayout({ withAppZod: false });
    const result = analyse(root);
    expect(result.zodDirs).toEqual([join(root, "node_modules/schema-lib/node_modules/zod")]);
    expect(result.fromLib).toBe('"nested"');
    expect(result.coreFromLib).toBe('"nested"');
  });
});
