import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { handlerDefinitionFindings } from "../guard-handler-definitions";

const ROOTS = [{ absPath: "/repo" }];
const DEMO = "/repo/src/features/demo";

function findingsFor(files: Record<string, string>): Record<string, number> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sources = Object.entries(files).map(([filePath, text]) =>
    project.createSourceFile(filePath, text),
  );
  return handlerDefinitionFindings(sources, ROOTS);
}

const WRITE = `export const archive = defineWriteHandler({ name: "a", handler: async () => ({}) });\n`;
const QUERY = `export const list = defineQueryHandler({ name: "l", handler: async () => ({}) });\n`;

describe("Handler Definitions guard: layout", () => {
  test("one defineWriteHandler in handlers/<topic>.write.ts is clean", () => {
    expect(findingsFor({ [`${DEMO}/handlers/archive.write.ts`]: WRITE })).toEqual({});
  });

  test("an inline r.writeHandler literal in feature.ts counts", () => {
    const counts = findingsFor({
      [`${DEMO}/feature.ts`]: `r.writeHandler({ name: "x", handler: async () => ({}) });\n`,
    });
    expect(counts).toEqual({ "src/features/demo/feature.ts": 1 });
  });

  test("a second handler and a wrong kind in one file count separately", () => {
    const counts = findingsFor({ [`${DEMO}/handlers/both.write.ts`]: WRITE + QUERY });
    expect(counts).toEqual({ "src/features/demo/handlers/both.write.ts": 2 });
  });

  test("a write handler in a .query.ts file counts", () => {
    const counts = findingsFor({ [`${DEMO}/handlers/list.query.ts`]: WRITE });
    expect(counts).toEqual({ "src/features/demo/handlers/list.query.ts": 1 });
  });

  test("a handler file without a .write/.query suffix counts", () => {
    const counts = findingsFor({ [`${DEMO}/handlers/archive.ts`]: WRITE });
    expect(counts).toEqual({ "src/features/demo/handlers/archive.ts": 1 });
  });

  test("files outside a feature are not subject to the layout", () => {
    expect(findingsFor({ "/repo/src/lib/x.ts": WRITE })).toEqual({});
  });
});

describe("Handler Definitions guard: callee names", () => {
  test("calls of inherited object methods are not handler definitions", () => {
    const counts = findingsFor({
      [`${DEMO}/web/format.ts`]: [
        "export const a = (value: number) => value.toString();",
        "export const b = (x: unknown) => String(x).valueOf();",
        "export const c = (x: { constructor: (v: number) => unknown }) => x.constructor(1);",
        "export const d = (x: object) => x.hasOwnProperty('k');",
        "",
      ].join("\n"),
    });
    expect(counts).toEqual({});
  });
});

describe("Handler Definitions guard: erased literals", () => {
  test("a literal typed WriteHandlerDef counts", () => {
    const counts = findingsFor({
      [`${DEMO}/lib/x.ts`]: `export const h: WriteHandlerDef = { name: "a", handler: async () => ({}) };\n`,
    });
    expect(counts).toEqual({ "src/features/demo/lib/x.ts": 1 });
  });

  test("a typed variable initialised by defineWriteHandler is only a layout finding", () => {
    const counts = findingsFor({
      [`${DEMO}/lib/x.ts`]: `export const h: WriteHandlerDef = defineWriteHandler({ name: "a", handler: async () => ({}) });\n`,
    });
    expect(counts).toEqual({ "src/features/demo/lib/x.ts": 1 });
  });

  test("a literal typed outside any feature still counts", () => {
    const counts = findingsFor({
      "/repo/src/lib/x.ts": `export const h: WriteHandlerDef = { name: "a" };\n`,
    });
    expect(counts).toEqual({ "src/lib/x.ts": 1 });
  });

  test("a function returning a literal as QueryHandlerDef counts", () => {
    const counts = findingsFor({
      "/repo/src/lib/x.ts": `export function make(): QueryHandlerDef {\n  return { name: "a" };\n}\n`,
    });
    expect(counts).toEqual({ "src/lib/x.ts": 1 });
  });

  test("satisfies and as on a literal count", () => {
    const counts = findingsFor({
      "/repo/src/lib/x.ts": `export const a = { name: "a" } satisfies WriteHandlerDef;\nexport const b = { name: "b" } as QueryHandlerDef;\n`,
    });
    expect(counts).toEqual({ "src/lib/x.ts": 2 });
  });
});

describe("Handler Definitions guard: markers", () => {
  test("a line marker above the finding silences it", () => {
    const counts = findingsFor({
      [`${DEMO}/lib/x.ts`]: `// kumiko-lint-ignore handler-definitions legacy shape kept for import\nexport const h: WriteHandlerDef = { name: "a" };\n`,
    });
    expect(counts).toEqual({});
  });

  test("a file marker in the leading comment silences the file", () => {
    const counts = findingsFor({
      [`${DEMO}/feature.ts`]: `// kumiko-lint-ignore-file handler-definitions legacy registration kept\n${WRITE}`,
    });
    expect(counts).toEqual({});
  });
});
