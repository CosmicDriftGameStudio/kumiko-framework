import { describe, expect, it } from "bun:test";
import { transformFeatureFactorySource } from "../scripts/codemod/feature-factory.js";
import { transformS3ImportsSource } from "../scripts/codemod/s3-imports.js";

const APP_FILE = "/repo/samples/apps/demo/src/run-config.ts";
const BUNDLED_FILE = "/repo/packages/bundled-features/src/file-foundation/__tests__/sample.test.ts";
const PKG = "@cosmicdrift/kumiko-bundled-features";

interface Fixture {
  readonly name: string;
  readonly filePath: string;
  readonly input: string;
  readonly expected: string;
  readonly rewrites: number;
  readonly manual: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: "package import of files-provider-s3 moves to file-provider-s3/lib",
    filePath: APP_FILE,
    input: `import { createS3Provider } from "${PKG}/files-provider-s3";\n`,
    expected: `import { createS3Provider } from "${PKG}/file-provider-s3/lib";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "export from, import() types, dynamic import and mock.module follow",
    filePath: APP_FILE,
    input: [
      `export { parseS3EnvConfig } from "${PKG}/files-provider-s3";`,
      `export type Config = import("${PKG}/files-provider-s3").S3ProviderConfig;`,
      `const lazy = await import("${PKG}/files-provider-s3");`,
      `mock.module("${PKG}/files-provider-s3", () => ({}));`,
      ``,
    ].join("\n"),
    expected: [
      `export { parseS3EnvConfig } from "${PKG}/file-provider-s3/lib";`,
      `export type Config = import("${PKG}/file-provider-s3/lib").S3ProviderConfig;`,
      `const lazy = await import("${PKG}/file-provider-s3/lib");`,
      `mock.module("${PKG}/file-provider-s3/lib", () => ({}));`,
      ``,
    ].join("\n"),
    rewrites: 4,
    manual: 0,
  },
  {
    name: "relative imports inside bundled-features point at file-provider-s3/lib",
    filePath: BUNDLED_FILE,
    input: [
      `import { createS3Provider } from "../../files-provider-s3/s3-provider.js";`,
      `import { parseS3EnvConfig } from "../../files-provider-s3/index.js";`,
      ``,
    ].join("\n"),
    expected: [
      `import { createS3Provider } from "../../file-provider-s3/lib/s3-provider.js";`,
      `import { parseS3EnvConfig } from "../../file-provider-s3/lib/index.js";`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "the env feature becomes createFileProviderS3Feature({ fromEnv: true })",
    filePath: APP_FILE,
    input: [
      `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";`,
      `export const APP_FEATURES = [fileProviderS3EnvFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createFileProviderS3Feature } from "${PKG}/file-provider-s3";`,
      ``,
      `export const APP_FEATURES = [createFileProviderS3Feature({ fromEnv: true })];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "the env feature merges into an existing file-provider-s3 import",
    filePath: APP_FILE,
    input: [
      `import { S3_SECRET_ACCESS_KEY } from "${PKG}/file-provider-s3";`,
      `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";`,
      `export const a = [fileProviderS3EnvFeature, S3_SECRET_ACCESS_KEY];`,
      ``,
    ].join("\n"),
    expected: [
      `import { S3_SECRET_ACCESS_KEY, createFileProviderS3Feature } from "${PKG}/file-provider-s3";`,
      `export const a = [createFileProviderS3Feature({ fromEnv: true }), S3_SECRET_ACCESS_KEY];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "the env feature through a relative path inside bundled-features",
    filePath: BUNDLED_FILE,
    input: [
      `import { fileProviderS3EnvFeature } from "../../file-provider-s3-env/index.js";`,
      `export const a = [fileProviderS3EnvFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createFileProviderS3Feature } from "../../file-provider-s3/index.js";`,
      ``,
      `export const a = [createFileProviderS3Feature({ fromEnv: true })];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "shorthand property keeps its key",
    filePath: APP_FILE,
    input: [
      `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";`,
      `export const features = { fileProviderS3EnvFeature };`,
      ``,
    ].join("\n"),
    expected: [
      `import { createFileProviderS3Feature } from "${PKG}/file-provider-s3";`,
      ``,
      `export const features = { fileProviderS3EnvFeature: createFileProviderS3Feature({ fromEnv: true }) };`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "typeof on the env feature and re-exports are reported and left alone",
    filePath: APP_FILE,
    input: [
      `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";`,
      `export type T = typeof fileProviderS3EnvFeature;`,
      `export { fileProviderS3EnvFeature as envFeature } from "${PKG}/file-provider-s3-env";`,
      ``,
    ].join("\n"),
    expected: [
      `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";`,
      `export type T = typeof fileProviderS3EnvFeature;`,
      `export { fileProviderS3EnvFeature as envFeature } from "${PKG}/file-provider-s3-env";`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 2,
  },
  {
    name: "an unrelated same-named symbol stays untouched",
    filePath: APP_FILE,
    input: [
      `import { fileProviderS3EnvFeature } from "./my-own.js";`,
      `export const a = [fileProviderS3EnvFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { fileProviderS3EnvFeature } from "./my-own.js";`,
      `export const a = [fileProviderS3EnvFeature];`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 0,
  },
];

const BOTH_FEATURES_INPUT = [
  `import { fileProviderS3Feature, S3_SECRET_ACCESS_KEY } from "${PKG}/file-provider-s3";`,
  `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";`,
  `export const a = [fileProviderS3Feature, fileProviderS3EnvFeature, S3_SECRET_ACCESS_KEY];`,
  ``,
].join("\n");

function sortedNamedImports(source: string): string {
  return source.replace(/import \{([^}]*)\}/g, (_match, names: string) => {
    const sorted = names
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .sort()
      .join(", ");
    return `import { ${sorted} }`;
  });
}

describe("s3-imports codemod", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: output matches`, () => {
      const result = transformS3ImportsSource(fixture.input, fixture.filePath);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(fixture.manual);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformS3ImportsSource(fixture.expected, fixture.filePath);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toHaveLength(0);
    });
  }

  it("leaves the same result as feature-factory in either order", () => {
    const factoryThenS3 = transformS3ImportsSource(
      transformFeatureFactorySource(BOTH_FEATURES_INPUT, APP_FILE).output,
      APP_FILE,
    ).output;
    const s3ThenFactory = transformFeatureFactorySource(
      transformS3ImportsSource(BOTH_FEATURES_INPUT, APP_FILE).output,
      APP_FILE,
    ).output;

    expect(sortedNamedImports(s3ThenFactory)).toBe(sortedNamedImports(factoryThenS3));
    expect(sortedNamedImports(factoryThenS3)).toBe(
      [
        `import { S3_SECRET_ACCESS_KEY, createFileProviderS3Feature } from "${PKG}/file-provider-s3";`,
        `export const a = [createFileProviderS3Feature(), createFileProviderS3Feature({ fromEnv: true }), S3_SECRET_ACCESS_KEY];`,
        ``,
      ].join("\n"),
    );
  });

  it("reports file and line for manual sites", () => {
    const result = transformS3ImportsSource(
      `import { fileProviderS3EnvFeature } from "${PKG}/file-provider-s3-env";\nexport type T = typeof fileProviderS3EnvFeature;\n`,
      APP_FILE,
    );

    expect(result.manual).toEqual([expect.objectContaining({ file: APP_FILE, line: 2 })]);
  });
});
