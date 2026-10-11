import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { parseSourceFile } from "../parse.js";
import { renderFeatureFile } from "../render.js";

function createProject() {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
}

function featureWithOptions(optionsSource: string): string {
  return `
const EXT_MY_EXTENSION = "my-extension";
defineFeature("fn-options", (r) => {
  r.useExtension(EXT_MY_EXTENSION, "photo", ${optionsSource});
});
`;
}

function parseOptions(optionsSource: string) {
  const sf = createProject().createSourceFile("inline.ts", featureWithOptions(optionsSource));
  return parseSourceFile(sf);
}

const FUNCTION_VALUES: ReadonlyArray<readonly [string, string]> = [
  ["typed arrow", "(x: Foo) => x.bar"],
  ["untyped arrow", "(x) => x.bar"],
  ["async arrow", "async (x) => await x.bar()"],
  ["function expression", "function (a) { return a + 1; }"],
];

describe("useExtension options with function values", () => {
  for (const [label, fnSource] of FUNCTION_VALUES) {
    test(`${label}: keys stay visible and the function is kept as __raw`, () => {
      const result = parseOptions(`{ label: "x", isPublic: ${fnSource} }`);
      expect(result.errors).toEqual([]);
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]).toMatchObject({
        kind: "useExtension",
        options: { label: "x", isPublic: { __raw: fnSource } },
      });
    });

    test(`${label}: render roundtrip keeps the function text`, () => {
      const first = parseOptions(`{ isPublic: ${fnSource} }`);
      const rendered = renderFeatureFile({
        featureName: "fn-options",
        patterns: first.patterns,
        imports: ['const EXT_MY_EXTENSION = "my-extension";'],
      });
      expect(rendered).toContain(fnSource);
      const second = parseSourceFile(createProject().createSourceFile("again.ts", rendered));
      expect(second.errors).toEqual([]);
      expect(second.patterns[0]).toMatchObject({
        options: { isPublic: { __raw: fnSource } },
      });
    });
  }
});

describe("useExtension name imported from a package specifier", () => {
  test("reads the name from an `export declare const` literal type in a .d.ts", () => {
    const project = createProject();
    const fs = project.getFileSystem();
    fs.writeFileSync(
      "/node_modules/ext-pkg/package.json",
      JSON.stringify({ name: "ext-pkg", types: "./index.d.ts" }),
    );
    fs.writeFileSync(
      "/node_modules/ext-pkg/index.d.ts",
      'export { EXT_FROM_DTS } from "./names.js";\n',
    );
    fs.writeFileSync(
      "/node_modules/ext-pkg/names.d.ts",
      'export declare const EXT_FROM_DTS: "from-dts";\n',
    );
    const sf = project.createSourceFile(
      "/app/feature.ts",
      `
import { EXT_FROM_DTS } from "ext-pkg";
defineFeature("pkg-name", (r) => {
  r.useExtension(EXT_FROM_DTS, "photo", { isPublic: () => true });
});
`,
    );
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns[0]).toMatchObject({
      kind: "useExtension",
      extensionName: "from-dts",
      extensionNameRaw: "EXT_FROM_DTS",
    });
  });
});
