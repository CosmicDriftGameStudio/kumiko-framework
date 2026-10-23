import { describe, expect, it } from "bun:test";
import {
  FEATURE_FACTORIES,
  transformFeatureFactorySource,
} from "../scripts/codemod/feature-factory.ts";

const APP_FILE = "/repo/samples/apps/demo/src/run-config.ts";
const BUNDLED_FILE = "/repo/packages/bundled-features/src/tags/__tests__/sample.test.ts";
const TAGS = "@cosmicdrift/kumiko-bundled-features/tags";
const LEDGER = "@cosmicdrift/kumiko-bundled-features/ledger";

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
    name: "package import and value reference become the factory call",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "${TAGS}";`,
      `export const APP_FEATURES = [tagsFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "${TAGS}";`,
      `export const APP_FEATURES = [createTagsFeature()];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "several references give several calls",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "${TAGS}";`,
      `const a = [tagsFeature];`,
      `const b = tagsFeature.exports;`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "${TAGS}";`,
      `const a = [createTagsFeature()];`,
      `const b = createTagsFeature().exports;`,
      ``,
    ].join("\n"),
    rewrites: 3,
    manual: 0,
  },
  {
    name: "typeof becomes ReturnType<typeof factory>",
    filePath: APP_FILE,
    input: [
      `import type { ledgerFeature } from "${LEDGER}";`,
      `export type LedgerFeature = typeof ledgerFeature;`,
      ``,
    ].join("\n"),
    expected: [
      `import type { createLedgerFeature } from "${LEDGER}";`,
      `export type LedgerFeature = ReturnType<typeof createLedgerFeature>;`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "shorthand property keeps its key",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "${TAGS}";`,
      `export const features = { tagsFeature };`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "${TAGS}";`,
      `export const features = { tagsFeature: createTagsFeature() };`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "merges into an existing import of the factory without duplicating it",
    filePath: APP_FILE,
    input: [
      `import { createTagsFeature, tagsFeature, type TagsFeatureOptions } from "${TAGS}";`,
      `export const a = [tagsFeature, createTagsFeature({ roles: ["x"] })];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature, type TagsFeatureOptions } from "${TAGS}";`,
      `export const a = [createTagsFeature(), createTagsFeature({ roles: ["x"] })];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "drops the whole declaration when the factory is imported on another line",
    filePath: APP_FILE,
    input: [
      `import { createTagsFeature } from "${TAGS}";`,
      `import { tagsFeature } from "${TAGS}";`,
      `export const a = [tagsFeature, createTagsFeature()];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "${TAGS}";`,
      `export const a = [createTagsFeature(), createTagsFeature()];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "relative imports inside bundled-features resolve to the defining module",
    filePath: BUNDLED_FILE,
    input: [
      `import { tagsFeature } from "../feature.js";`,
      `import { ledgerFeature } from "../../ledger/index.js";`,
      `export const a = [tagsFeature, ledgerFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "../feature.js";`,
      `import { createLedgerFeature } from "../../ledger/index.js";`,
      `export const a = [createTagsFeature(), createLedgerFeature()];`,
      ``,
    ].join("\n"),
    rewrites: 4,
    manual: 0,
  },
  {
    name: "a same-named symbol from another package stays untouched",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "./my-own-tags.js";`,
      `export const a = [tagsFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { tagsFeature } from "./my-own-tags.js";`,
      `export const a = [tagsFeature];`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 0,
  },
  {
    name: "a local binding that shadows the import stays untouched",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "${TAGS}";`,
      `export function f(tagsFeature: string) {`,
      `  return tagsFeature;`,
      `}`,
      `export const a = [tagsFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "${TAGS}";`,
      `export function f(tagsFeature: string) {`,
      `  return tagsFeature;`,
      `}`,
      `export const a = [createTagsFeature()];`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "an aliased import is reported and left alone",
    filePath: APP_FILE,
    input: [`import { tagsFeature as tags } from "${TAGS}";`, `export const a = [tags];`, ``].join(
      "\n",
    ),
    expected: [
      `import { tagsFeature as tags } from "${TAGS}";`,
      `export const a = [tags];`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 1,
  },
  {
    name: "a file that compares the feature by identity is reported and left alone",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "${TAGS}";`,
      `export const a = [tagsFeature];`,
      `export const isTags = (f: unknown) => f === tagsFeature;`,
      ``,
    ].join("\n"),
    expected: [
      `import { tagsFeature } from "${TAGS}";`,
      `export const a = [tagsFeature];`,
      `export const isTags = (f: unknown) => f === tagsFeature;`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 1,
  },
  {
    name: "identity-comparing calls count as identity use",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "${TAGS}";`,
      `expect(list).toContain(tagsFeature);`,
      ``,
    ].join("\n"),
    expected: [
      `import { tagsFeature } from "${TAGS}";`,
      `expect(list).toContain(tagsFeature);`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 1,
  },
  {
    name: "a re-export is reported, one that also exports the factory is not",
    filePath: BUNDLED_FILE,
    input: [
      `export { tagsFeature } from "../feature.js";`,
      `export { createLedgerFeature, ledgerFeature } from "../../ledger/feature.js";`,
      ``,
    ].join("\n"),
    expected: [
      `export { tagsFeature } from "../feature.js";`,
      `export { createLedgerFeature, ledgerFeature } from "../../ledger/feature.js";`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 1,
  },
  {
    name: "a local export of the imported constant is reported and left alone",
    filePath: APP_FILE,
    input: [`import { tagsFeature } from "${TAGS}";`, `export { tagsFeature };`, ``].join("\n"),
    expected: [`import { createTagsFeature } from "${TAGS}";`, `export { tagsFeature };`, ``].join(
      "\n",
    ),
    rewrites: 1,
    manual: 1,
  },
  {
    name: "a namespace import that touches the constant is reported",
    filePath: APP_FILE,
    input: [`import * as tags from "${TAGS}";`, `export const a = [tags.tagsFeature];`, ``].join(
      "\n",
    ),
    expected: [`import * as tags from "${TAGS}";`, `export const a = [tags.tagsFeature];`, ``].join(
      "\n",
    ),
    rewrites: 0,
    manual: 1,
  },
  {
    name: "the constant imported from a subpath that does not own it is reported",
    filePath: APP_FILE,
    input: [
      `import { tagsFeature } from "@cosmicdrift/kumiko-bundled-features/ledger";`,
      `export const a = [tagsFeature];`,
      ``,
    ].join("\n"),
    expected: [
      `import { tagsFeature } from "@cosmicdrift/kumiko-bundled-features/ledger";`,
      `export const a = [tagsFeature];`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 1,
  },
  {
    name: "factory calls without the constant are left alone",
    filePath: APP_FILE,
    input: [
      `import { createTagsFeature } from "${TAGS}";`,
      `export const a = [createTagsFeature()];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTagsFeature } from "${TAGS}";`,
      `export const a = [createTagsFeature()];`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 0,
  },
];

describe("feature-factory codemod", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: output matches`, () => {
      const result = transformFeatureFactorySource(fixture.input, fixture.filePath);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(fixture.manual);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformFeatureFactorySource(fixture.expected, fixture.filePath);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toHaveLength(0);
    });
  }

  it("reports file and line for manual sites", () => {
    const result = transformFeatureFactorySource(
      `import { tagsFeature as tags } from "${TAGS}";\nexport const a = [tags];\n`,
      APP_FILE,
    );

    expect(result.manual).toEqual([expect.objectContaining({ file: APP_FILE, line: 1 })]);
  });

  it("maps every constant to a create<Name> factory in its own folder", () => {
    for (const [constant, entry] of Object.entries(FEATURE_FACTORIES)) {
      expect(entry.factory).toBe(`create${constant[0]?.toUpperCase()}${constant.slice(1)}`);
      expect(entry.folder).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
