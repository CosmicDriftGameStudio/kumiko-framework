import { describe, expect, it } from "bun:test";
import { Project } from "ts-morph";
import { transformDefineHandlers } from "../scripts/codemod/define-handler.ts";

const FILE = "/repo/src/billing/handlers/sample.write.ts";
const ENGINE = "@cosmicdrift/kumiko-framework/engine";
const WRITE_TYPE_IMPORT = `import type { WriteHandlerDef } from "${ENGINE}";`;
const QUERY_TYPE_IMPORT = `import type { QueryHandlerDef } from "${ENGINE}";`;
const WRITE_VALUE_IMPORT = `import { defineWriteHandler } from "${ENGINE}";`;
const QUERY_VALUE_IMPORT = `import { defineQueryHandler } from "${ENGINE}";`;
const ZOD_IMPORT = `import { z } from "zod";`;

function lines(...rows: readonly string[]): string {
  return `${rows.join("\n")}\n`;
}

function transformFiles(sources: Readonly<Record<string, string>>) {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, source] of Object.entries(sources)) project.createSourceFile(path, source);
  return transformDefineHandlers(project, Object.keys(sources));
}

function transformOne(source: string, file: string = FILE) {
  return (
    transformFiles({ [file]: source }).get(file) ?? { output: source, rewrites: [], manual: [] }
  );
}

interface RewriteFixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  readonly rewrites: number;
}

const REWRITE_FIXTURES: readonly RewriteFixture[] = [
  {
    name: "a const with a cast, its marker comment and the payload alias",
    input: lines(
      WRITE_TYPE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({ id: z.string() });`,
      `type Payload = z.infer<typeof schema>;`,
      ``,
      `export const archiveHandler: WriteHandlerDef = {`,
      `  name: "archive",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async (event) => {`,
      `    // @cast-boundary engine-payload: the dispatcher parsed it against schema`,
      `    const payload = event.payload as Payload;`,
      `    return { isSuccess: true as const, data: { id: payload.id } };`,
      `  },`,
      `};`,
    ),
    expected: lines(
      WRITE_VALUE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({ id: z.string() });`,
      ``,
      `export const archiveHandler = defineWriteHandler({`,
      `  name: "archive",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async (event) => {`,
      `    const payload = event.payload;`,
      `    return { isSuccess: true as const, data: { id: payload.id } };`,
      `  },`,
      `});`,
    ),
    rewrites: 1,
  },
  {
    name: "a factory whose handler re-parses the payload with its own schema",
    input: lines(
      QUERY_TYPE_IMPORT,
      `import { MAX_LIST_LIMIT } from "./limits";`,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({ limit: z.number().max(MAX_LIST_LIMIT) });`,
      ``,
      `export function createListQuery(): QueryHandlerDef {`,
      `  return {`,
      `    name: "list",`,
      `    schema,`,
      `    access: { roles: ["Admin"] },`,
      `    handler: async (query) => {`,
      `      const { limit } = schema.parse(query.payload);`,
      `      return { isSuccess: true as const, data: { limit } };`,
      `    },`,
      `  };`,
      `}`,
    ),
    expected: lines(
      QUERY_VALUE_IMPORT,
      `import { MAX_LIST_LIMIT } from "./limits";`,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({ limit: z.number().max(MAX_LIST_LIMIT) });`,
      ``,
      `export function createListQuery() {`,
      `  return defineQueryHandler({`,
      `    name: "list",`,
      `    schema,`,
      `    access: { roles: ["Admin"] },`,
      `    handler: async (query) => {`,
      `      const { limit } = query.payload;`,
      `      return { isSuccess: true as const, data: { limit } };`,
      `    },`,
      `  });`,
      `}`,
    ),
    rewrites: 1,
  },
  {
    name: "an arrow factory with an expression body",
    input: lines(
      QUERY_TYPE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({});`,
      ``,
      `export const createPing = (): QueryHandlerDef => ({`,
      `  name: "ping",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `});`,
    ),
    expected: lines(
      QUERY_VALUE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({});`,
      ``,
      `export const createPing = () => defineQueryHandler({`,
      `  name: "ping",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `});`,
    ),
    rewrites: 1,
  },
  {
    name: "a wrapper that returns a converted factory (only the annotation goes)",
    input: lines(
      WRITE_TYPE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({});`,
      ``,
      `function createBase(): WriteHandlerDef {`,
      `  return {`,
      `    name: "base",`,
      `    schema,`,
      `    access: { roles: ["Admin"] },`,
      `    handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `  };`,
      `}`,
      ``,
      `export function createWrapped(): WriteHandlerDef {`,
      `  return createBase();`,
      `}`,
    ),
    expected: lines(
      WRITE_VALUE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({});`,
      ``,
      `function createBase() {`,
      `  return defineWriteHandler({`,
      `    name: "base",`,
      `    schema,`,
      `    access: { roles: ["Admin"] },`,
      `    handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `  });`,
      `}`,
      ``,
      `export function createWrapped() {`,
      `  return createBase();`,
      `}`,
    ),
    rewrites: 2,
  },
  {
    name: "a conditional spread and a lint-ignore comment inside the handler",
    input: lines(
      WRITE_TYPE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({});`,
      `const isPublic = true;`,
      ``,
      `export const submit: WriteHandlerDef = {`,
      `  name: "submit",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  ...(isPublic && { tenantlessAnonymous: true }),`,
      `  // kumiko-lint-ignore complexity-budget: sequential steps`,
      `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `};`,
    ),
    expected: lines(
      WRITE_VALUE_IMPORT,
      ZOD_IMPORT,
      ``,
      `const schema = z.object({});`,
      `const isPublic = true;`,
      ``,
      `export const submit = defineWriteHandler({`,
      `  name: "submit",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  ...(isPublic && { tenantlessAnonymous: true }),`,
      `  // kumiko-lint-ignore complexity-budget: sequential steps`,
      `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `});`,
    ),
    rewrites: 1,
  },
  {
    name: "a handler passed first to withCapEnforcement",
    input: lines(
      WRITE_TYPE_IMPORT,
      ZOD_IMPORT,
      `import { withCapEnforcement } from "./cap";`,
      ``,
      `const schema = z.object({});`,
      ``,
      `const inner: WriteHandlerDef = {`,
      `  name: "inner",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `};`,
      ``,
      `export const capped = withCapEnforcement(inner, registrar);`,
    ),
    expected: lines(
      WRITE_VALUE_IMPORT,
      ZOD_IMPORT,
      `import { withCapEnforcement } from "./cap";`,
      ``,
      `const schema = z.object({});`,
      ``,
      `const inner = defineWriteHandler({`,
      `  name: "inner",`,
      `  schema,`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `});`,
      ``,
      `export const capped = withCapEnforcement(inner, registrar);`,
    ),
    rewrites: 1,
  },
  {
    name: "a type-only import next to other specifiers",
    input: lines(
      `import type { HandlerContext, WriteHandlerDef } from "${ENGINE}";`,
      ZOD_IMPORT,
      ``,
      `export const touch: WriteHandlerDef = {`,
      `  name: "touch",`,
      `  schema: z.object({}),`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async (_event, ctx: HandlerContext) => ({ isSuccess: true as const, data: {} }),`,
      `};`,
    ),
    expected: lines(
      `import { type HandlerContext, defineWriteHandler } from "${ENGINE}";`,
      ZOD_IMPORT,
      ``,
      `export const touch = defineWriteHandler({`,
      `  name: "touch",`,
      `  schema: z.object({}),`,
      `  access: { roles: ["Admin"] },`,
      `  handler: async (_event, ctx: HandlerContext) => ({ isSuccess: true as const, data: {} }),`,
      `});`,
    ),
    rewrites: 1,
  },
];

const CAST_MISMATCH_INPUT = lines(
  WRITE_TYPE_IMPORT,
  ZOD_IMPORT,
  ``,
  `const schema = z.object({ id: z.string() });`,
  `const other = z.object({ count: z.number() });`,
  ``,
  `export const mismatch: WriteHandlerDef = {`,
  `  name: "mismatch",`,
  `  schema,`,
  `  access: { roles: ["Admin"] },`,
  `  handler: async (event) => {`,
  `    const payload = event.payload as z.infer<typeof other>;`,
  `    return { isSuccess: true as const, data: { count: payload.count } };`,
  `  },`,
  `};`,
);

const CAST_MISMATCH_EXPECTED = lines(
  WRITE_VALUE_IMPORT,
  ZOD_IMPORT,
  ``,
  `const schema = z.object({ id: z.string() });`,
  `const other = z.object({ count: z.number() });`,
  ``,
  `export const mismatch = defineWriteHandler({`,
  `  name: "mismatch",`,
  `  schema,`,
  `  access: { roles: ["Admin"] },`,
  `  handler: async (event) => {`,
  `    const payload = event.payload as z.infer<typeof other>;`,
  `    return { isSuccess: true as const, data: { count: payload.count } };`,
  `  },`,
  `});`,
);

interface UnchangedFixture {
  readonly name: string;
  readonly input: string;
  readonly line: number;
  readonly description: string;
}

const HANDLER_BODY = [
  `  access: { roles: ["Admin"] },`,
  `  handler: async () => ({ isSuccess: true as const, data: {} }),`,
];

const UNCHANGED_FIXTURES: readonly UnchangedFixture[] = [
  {
    name: "a handler that spreads another handler",
    input: lines(
      WRITE_TYPE_IMPORT,
      `import { baseHandler } from "./base";`,
      ``,
      `export const wrapped: WriteHandlerDef = { ...baseHandler, name: "wrapped" };`,
    ),
    line: 4,
    description: "WriteHandlerDef wrapped stays: the literal spreads another value into the handler",
  },
  {
    name: "a dynamic schema",
    input: lines(
      WRITE_TYPE_IMPORT,
      `import { entity } from "./entity";`,
      `import { buildInsertSchema } from "./schema";`,
      ``,
      `export const insert: WriteHandlerDef = {`,
      `  name: "insert",`,
      `  schema: buildInsertSchema(entity),`,
      ...HANDLER_BODY,
      `};`,
    ),
    line: 5,
    description: "WriteHandlerDef insert stays: the schema is built dynamically",
  },
  {
    name: "a schema that is a local of the factory",
    input: lines(
      WRITE_TYPE_IMPORT,
      ZOD_IMPORT,
      ``,
      `export function createLocal(): WriteHandlerDef {`,
      `  const schema = z.object({});`,
      `  return {`,
      `    name: "local",`,
      `    schema,`,
      `    access: { roles: ["Admin"] },`,
      `    handler: async () => ({ isSuccess: true as const, data: {} }),`,
      `  };`,
      `}`,
    ),
    line: 4,
    description: "WriteHandlerDef createLocal stays: the schema is built dynamically",
  },
  {
    name: "a satisfies form",
    input: lines(
      WRITE_TYPE_IMPORT,
      ``,
      `export const checked = { name: "checked" } satisfies WriteHandlerDef;`,
    ),
    line: 3,
    description: "WriteHandlerDef: satisfies/as form, type the handler by hand",
  },
  {
    name: "an as form",
    input: lines(
      QUERY_TYPE_IMPORT,
      ``,
      `export const forced = { name: "forced" } as QueryHandlerDef;`,
    ),
    line: 3,
    description: "QueryHandlerDef: satisfies/as form, type the handler by hand",
  },
  {
    name: "a handler that is not an object literal",
    input: lines(
      WRITE_TYPE_IMPORT,
      `import { make } from "./make";`,
      ``,
      `export const made: WriteHandlerDef = make();`,
    ),
    line: 4,
    description: "WriteHandlerDef: the initializer is not an object literal",
  },
  {
    name: "a handler with excludedFields",
    input: lines(
      WRITE_TYPE_IMPORT,
      ZOD_IMPORT,
      ``,
      `export const excluding: WriteHandlerDef = {`,
      `  name: "excluding",`,
      `  schema: z.object({}),`,
      `  excludedFields: ["secret"],`,
      ...HANDLER_BODY,
      `};`,
    ),
    line: 4,
    description: "WriteHandlerDef excluding stays: the literal carries excludedFields",
  },
];

describe("define-handler codemod", () => {
  for (const fixture of REWRITE_FIXTURES) {
    it(`rewrites ${fixture.name}`, () => {
      const result = transformOne(fixture.input);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toEqual([]);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformOne(fixture.expected);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toEqual([]);
      expect(second.manual).toEqual([]);
    });
  }

  it("converts the definition and keeps a cast on a foreign schema, reporting it", () => {
    const result = transformOne(CAST_MISMATCH_INPUT);
    const castLine =
      CAST_MISMATCH_INPUT.split("\n").findIndex((row) => row.includes("event.payload as")) + 1;

    expect(result.output).toBe(CAST_MISMATCH_EXPECTED);
    expect(result.rewrites).toHaveLength(1);
    expect(result.manual).toEqual([
      {
        file: FILE,
        line: castLine,
        description: "payload cast does not match the schema, the definition is converted",
      },
    ]);
    expect(transformOne(CAST_MISMATCH_EXPECTED).output).toBe(CAST_MISMATCH_EXPECTED);
  });

  for (const fixture of UNCHANGED_FIXTURES) {
    it(`leaves ${fixture.name} unchanged and reports it`, () => {
      const result = transformOne(fixture.input);

      expect(result.output).toBe(fixture.input);
      expect(result.rewrites).toEqual([]);
      expect(result.manual).toEqual([
        { file: FILE, line: fixture.line, description: fixture.description },
      ]);
    });
  }

  it("skips test paths", () => {
    const file = "/repo/src/billing/__tests__/sample.write.ts";
    const input = REWRITE_FIXTURES[0]?.input ?? "";

    expect(transformFiles({ [file]: input }).size).toBe(0);
    expect(transformFiles({ "/repo/src/billing/sample.test.ts": input }).size).toBe(0);
  });

  it("converts a handler used by r.writeHandler and keeps the ones used elsewhere", () => {
    const handler = (name: string): string =>
      lines(
        WRITE_TYPE_IMPORT,
        ZOD_IMPORT,
        ``,
        `export const ${name}: WriteHandlerDef = {`,
        `  name: "${name}",`,
        `  schema: z.object({}),`,
        ...HANDLER_BODY,
        `};`,
      );
    const converted = lines(
      WRITE_VALUE_IMPORT,
      ZOD_IMPORT,
      ``,
      `export const a = defineWriteHandler({`,
      `  name: "a",`,
      `  schema: z.object({}),`,
      ...HANDLER_BODY,
      `});`,
    );
    const wrap = lines(
      `import { b } from "./handlers/b.write";`,
      ``,
      `function withAudit(handler: unknown): unknown {`,
      `  return handler;`,
      `}`,
      ``,
      `export const audited = withAudit(b);`,
    );
    const annotatedTest = lines(
      WRITE_TYPE_IMPORT,
      `import { c } from "./c.write";`,
      ``,
      `export const annotated: WriteHandlerDef = c;`,
    );

    const results = transformFiles({
      "/repo/src/handlers/a.write.ts": handler("a"),
      "/repo/src/handlers/b.write.ts": handler("b"),
      "/repo/src/handlers/c.write.ts": handler("c"),
      "/repo/src/handlers/c.test.ts": annotatedTest,
      "/repo/src/feature.ts": lines(
        `import { a } from "./handlers/a.write";`,
        ``,
        `export function register(registrar: { writeHandler(handler: unknown): void }): void {`,
        `  registrar.writeHandler(a);`,
        `}`,
      ),
      "/repo/src/wrap.ts": wrap,
    });

    const a = results.get("/repo/src/handlers/a.write.ts");
    const b = results.get("/repo/src/handlers/b.write.ts");
    const c = results.get("/repo/src/handlers/c.write.ts");
    expect(a?.output).toBe(converted);
    expect(a?.manual).toEqual([]);
    expect(b?.output).toBe(handler("b"));
    expect(b?.rewrites).toEqual([]);
    expect(b?.manual).toEqual([
      {
        file: "/repo/src/handlers/b.write.ts",
        line: 4,
        description:
          "WriteHandlerDef b stays: used as CallExpression, not a registrar call, re-export or cap wrapper at /repo/src/wrap.ts:7",
      },
    ]);
    expect(c?.output).toBe(handler("c"));
    expect(c?.manual).toEqual([
      {
        file: "/repo/src/handlers/c.write.ts",
        line: 4,
        description:
          "WriteHandlerDef c stays: used as VariableDeclaration, not a registrar call, re-export or cap wrapper at /repo/src/handlers/c.test.ts:4",
      },
    ]);
    expect(results.has("/repo/src/handlers/c.test.ts")).toBe(false);
  });
});
