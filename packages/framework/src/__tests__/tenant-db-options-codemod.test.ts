import { describe, expect, it } from "bun:test";
import { transformTenantDbOptionsSource } from "../scripts/codemod/tenant-db-options.ts";

const CONSUMER_FILE = "/repo/packages/bundled-features/src/note/sample.ts";
const FRAMEWORK_FILE = "/repo/packages/framework/src/pipeline/__tests__/sample.test.ts";
const IMPORT = `import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";`;

interface Fixture {
  readonly name: string;
  readonly filePath: string;
  readonly input: string;
  readonly expected: string;
  readonly rewrites: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: "two arguments with matching names use shorthand",
    filePath: CONSUMER_FILE,
    input: [IMPORT, `const a = createTenantDb(db, tenantId);`, ``].join("\n"),
    expected: [IMPORT, `const a = createTenantDb({ db, tenantId });`, ``].join("\n"),
    rewrites: 1,
  },
  {
    name: "three arguments keep an explicit tenant mode",
    filePath: CONSUMER_FILE,
    input: [IMPORT, `const a = createTenantDb(conn, t, "tenant");`, ``].join("\n"),
    expected: [
      IMPORT,
      `const a = createTenantDb({ db: conn, tenantId: t, mode: "tenant" });`,
      ``,
    ].join("\n"),
    rewrites: 1,
  },
  {
    name: "seven arguments map to every option",
    filePath: CONSUMER_FILE,
    input: [
      IMPORT,
      `const a = createTenantDb(tx, tenantId, "system", tracer, ctx.meter, signal, txGrants);`,
      ``,
    ].join("\n"),
    expected: [
      IMPORT,
      `const a = createTenantDb({ db: tx, tenantId, mode: "system", tracer, meter: ctx.meter, signal, grants: txGrants });`,
      ``,
    ].join("\n"),
    rewrites: 1,
  },
  {
    name: "literal undefined arguments are dropped",
    filePath: CONSUMER_FILE,
    input: [
      IMPORT,
      `const a = createTenantDb(db, t, "tenant", undefined, undefined, signal);`,
      `const b = createTenantDb(db, t, undefined, undefined, undefined, undefined, { projectionRegistry });`,
      `const c = createTenantDb(db, t, "tenant", undefined);`,
      ``,
    ].join("\n"),
    expected: [
      IMPORT,
      `const a = createTenantDb({ db, tenantId: t, mode: "tenant", signal });`,
      `const b = createTenantDb({ db, tenantId: t, grants: { projectionRegistry } });`,
      `const c = createTenantDb({ db, tenantId: t, mode: "tenant" });`,
      ``,
    ].join("\n"),
    rewrites: 3,
  },
  {
    name: "comments between and after arguments are preserved",
    filePath: CONSUMER_FILE,
    input: [
      IMPORT,
      `const a = createTenantDb(`,
      `  db, // the runner`,
      `  // scoped to one tenant`,
      `  tenantId,`,
      `  "system", /* cross-tenant job */`,
      `);`,
      ``,
    ].join("\n"),
    expected: [
      IMPORT,
      `const a = createTenantDb({`,
      `db, // the runner`,
      `// scoped to one tenant`,
      `tenantId,`,
      `mode: "system", /* cross-tenant job */`,
      `});`,
      ``,
    ].join("\n"),
    rewrites: 1,
  },
  {
    name: "aliased import and awaited argument expressions",
    filePath: CONSUMER_FILE,
    input: [
      `import { createTenantDb as makeDb } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = makeDb(await open(url), id as TenantId);`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTenantDb as makeDb } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = makeDb({ db: await open(url), tenantId: id as TenantId });`,
      ``,
    ].join("\n"),
    rewrites: 1,
  },
  {
    name: "relative framework import and nested call",
    filePath: FRAMEWORK_FILE,
    input: [
      `import { createTenantDb } from "../../db/tenant-db.js";`,
      `const a = createTenantDb(tenantDbRunner(createTenantDb(db, a)), b);`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTenantDb } from "../../db/tenant-db.js";`,
      `const a = createTenantDb({ db: tenantDbRunner(createTenantDb({ db, tenantId: a })), tenantId: b });`,
      ``,
    ].join("\n"),
    rewrites: 2,
  },
  {
    name: "namespace and dynamic imports are resolved",
    filePath: CONSUMER_FILE,
    input: [
      `import * as fw from "@cosmicdrift/kumiko-framework/db";`,
      `const a = fw.createTenantDb(db, t);`,
      `const { createTenantDb } = await import("@cosmicdrift/kumiko-framework/db");`,
      `const b = createTenantDb(db, t);`,
      ``,
    ].join("\n"),
    expected: [
      `import * as fw from "@cosmicdrift/kumiko-framework/db";`,
      `const a = fw.createTenantDb({ db, tenantId: t });`,
      `const { createTenantDb } = await import("@cosmicdrift/kumiko-framework/db");`,
      `const b = createTenantDb({ db, tenantId: t });`,
      ``,
    ].join("\n"),
    rewrites: 2,
  },
  {
    name: "object form is left alone",
    filePath: CONSUMER_FILE,
    input: [IMPORT, `const a = createTenantDb({ db, tenantId, mode: "system" });`, ``].join("\n"),
    expected: [IMPORT, `const a = createTenantDb({ db, tenantId, mode: "system" });`, ``].join(
      "\n",
    ),
    rewrites: 0,
  },
  {
    name: "a local function with the same name is not touched",
    filePath: CONSUMER_FILE,
    input: [
      `function createTenantDb(a: string, b: string) { return a + b; }`,
      `const x = createTenantDb("a", "b");`,
      ``,
    ].join("\n"),
    expected: [
      `function createTenantDb(a: string, b: string) { return a + b; }`,
      `const x = createTenantDb("a", "b");`,
      ``,
    ].join("\n"),
    rewrites: 0,
  },
  {
    name: "a local shadow of the imported name is not touched",
    filePath: CONSUMER_FILE,
    input: [
      IMPORT,
      `export function run(createTenantDb: (a: string, b: string) => void) {`,
      `  createTenantDb("a", "b");`,
      `}`,
      ``,
    ].join("\n"),
    expected: [
      IMPORT,
      `export function run(createTenantDb: (a: string, b: string) => void) {`,
      `  createTenantDb("a", "b");`,
      `}`,
      ``,
    ].join("\n"),
    rewrites: 0,
  },
  {
    name: "same name imported from another package is not touched",
    filePath: CONSUMER_FILE,
    input: [
      `import { createTenantDb } from "some-other-lib";`,
      `const x = createTenantDb(db, t);`,
      ``,
    ].join("\n"),
    expected: [
      `import { createTenantDb } from "some-other-lib";`,
      `const x = createTenantDb(db, t);`,
      ``,
    ].join("\n"),
    rewrites: 0,
  },
];

interface ManualFixture {
  readonly name: string;
  readonly code: string;
  readonly line: number;
  readonly mentions: string;
}

const MANUAL_FIXTURES: readonly ManualFixture[] = [
  {
    name: "spread argument",
    code: `createTenantDb(...args);`,
    line: 2,
    mentions: "spread",
  },
  {
    name: "more than seven arguments",
    code: `createTenantDb(a, b, c, d, e, f, g, h);`,
    line: 2,
    mentions: "8 arguments",
  },
  {
    name: "single non-object argument",
    code: `createTenantDb(options);`,
    line: 2,
    mentions: "1 argument(s)",
  },
  {
    name: "used as a value",
    code: `const factory = createTenantDb;`,
    line: 2,
    mentions: "used as a value",
  },
  {
    name: "passed as a callback",
    code: `ids.map(createTenantDb);`,
    line: 2,
    mentions: "used as a value",
  },
  {
    name: ".bind",
    code: `const bound = createTenantDb.bind(null, db);`,
    line: 2,
    mentions: "used as a value",
  },
  {
    name: ".call",
    code: `createTenantDb.call(null, db, t);`,
    line: 2,
    mentions: "used as a value",
  },
  {
    name: ".apply",
    code: `createTenantDb.apply(null, [db, t]);`,
    line: 2,
    mentions: "used as a value",
  },
];

describe("tenant-db-options codemod", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: output matches`, () => {
      const result = transformTenantDbOptionsSource(fixture.input, fixture.filePath);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(0);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformTenantDbOptionsSource(fixture.expected, fixture.filePath);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toHaveLength(0);
      expect(second.manual).toHaveLength(0);
    });
  }

  for (const fixture of MANUAL_FIXTURES) {
    it(`reports ${fixture.name} as manual and leaves the source`, () => {
      const input = [IMPORT, fixture.code, ``].join("\n");
      const result = transformTenantDbOptionsSource(input, CONSUMER_FILE);

      expect(result.output).toBe(input);
      expect(result.rewrites).toHaveLength(0);
      expect(result.manual).toEqual([
        expect.objectContaining({
          file: CONSUMER_FILE,
          line: fixture.line,
          description: expect.stringContaining(fixture.mentions),
        }),
      ]);
    });
  }

  it("rewrites the mappable calls of a file and reports the rest", () => {
    const input = [IMPORT, `createTenantDb(db, t);`, `createTenantDb(...args);`, ``].join("\n");
    const result = transformTenantDbOptionsSource(input, CONSUMER_FILE);

    expect(result.output).toBe(
      [IMPORT, `createTenantDb({ db, tenantId: t });`, `createTenantDb(...args);`, ``].join("\n"),
    );
    expect(result.rewrites).toHaveLength(1);
    expect(result.manual).toHaveLength(1);
  });
});
