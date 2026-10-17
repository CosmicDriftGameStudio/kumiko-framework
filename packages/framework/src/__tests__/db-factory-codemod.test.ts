import { describe, expect, it } from "bun:test";
import { transformDbFactorySource } from "../scripts/codemod/db-factory.js";

const CONSUMER_FILE = "/repo/packages/bundled-features/src/note/sample.ts";
const FRAMEWORK_FILE = "/repo/packages/framework/src/pipeline/__tests__/sample.test.ts";
const TESTING_FILE = "/repo/packages/testing/src/stack/db.ts";

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
    name: "package import /bun-db becomes /db",
    filePath: CONSUMER_FILE,
    input: `import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";\n`,
    expected: `import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/db";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "import type, export from and import() types follow",
    filePath: CONSUMER_FILE,
    input: [
      `import type { SelectOptions } from "@cosmicdrift/kumiko-framework/bun-db";`,
      `export { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";`,
      `export type Row = import("@cosmicdrift/kumiko-framework/bun-db").TableInfo;`,
      `const lazy = await import("@cosmicdrift/kumiko-framework/bun-db");`,
      ``,
    ].join("\n"),
    expected: [
      `import type { SelectOptions } from "@cosmicdrift/kumiko-framework/db";`,
      `export { insertOne } from "@cosmicdrift/kumiko-framework/db";`,
      `export type Row = import("@cosmicdrift/kumiko-framework/db").TableInfo;`,
      `const lazy = await import("@cosmicdrift/kumiko-framework/db");`,
      ``,
    ].join("\n"),
    rewrites: 4,
    manual: 0,
  },
  {
    name: "merges into an existing /db import of the same kind",
    filePath: CONSUMER_FILE,
    input: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";`,
      ``,
    ].join("\n"),
    rewrites: 1,
    manual: 0,
  },
  {
    name: "relative framework specifiers point at db/query",
    filePath: FRAMEWORK_FILE,
    input: [
      `import { selectMany } from "../../bun-db/query.js";`,
      `import type { AnyDb } from "../../bun-db/index.js";`,
      `import { fetchOne } from "../../db/query-api.js";`,
      ``,
    ].join("\n"),
    expected: [
      `import { selectMany, fetchOne } from "../../db/query.js";`,
      `import type { AnyDb } from "../../db/query.js";`,
      ``,
    ].join("\n"),
    rewrites: 3,
    manual: 0,
  },
  {
    name: "mock.module follows the moved module",
    filePath: FRAMEWORK_FILE,
    input: `mock.module("../../bun-db/query.js", () => ({}));\n`,
    expected: `mock.module("../../db/query.js", () => ({}));\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "createDbConnection(url) becomes the object form",
    filePath: CONSUMER_FILE,
    input: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection(config.databaseUrl);`,
      `const b = createDbConnection(url);`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection({ url: config.databaseUrl });`,
      `const b = createDbConnection({ url });`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "createDbConnection(url, { ... }) keeps properties and comments",
    filePath: CONSUMER_FILE,
    input: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection(requiredEnv("DATABASE_URL"), { maxConnections: 2 });`,
      `const b = createDbConnection(url, {`,
      `  // small pool: migrations only`,
      `  maxConnections: 1,`,
      `  idleTimeoutSeconds: 5,`,
      `});`,
      `const c = createDbConnection(url, {});`,
      `const d = createDbConnection(url, {`,
      `  maxConnections: 1, // trailing note`,
      `});`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection({ url: requiredEnv("DATABASE_URL"), maxConnections: 2 });`,
      `const b = createDbConnection({ url,`,
      `// small pool: migrations only`,
      `  maxConnections: 1,`,
      `  idleTimeoutSeconds: 5`,
      `});`,
      `const c = createDbConnection({ url });`,
      `const d = createDbConnection({ url,`,
      `maxConnections: 1, // trailing note`,
      `});`,
      ``,
    ].join("\n"),
    rewrites: 4,
    manual: 0,
  },
  {
    name: "createDbConnection(url, expr) spreads the expression",
    filePath: CONSUMER_FILE,
    input: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection(databaseUrl, dbConnectionOptionsFromEnv(env));`,
      `const b = createDbConnection(x.replace("a", "b"));`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection({ url: databaseUrl, ...dbConnectionOptionsFromEnv(env) });`,
      `const b = createDbConnection({ url: x.replace("a", "b") });`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "object form is left alone",
    filePath: CONSUMER_FILE,
    input: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection({ url, maxConnections: 4 });`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";`,
      `const a = createDbConnection({ url, maxConnections: 4 });`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 0,
  },
  {
    name: "createConnection from stack-support: rename, drop await, object form",
    filePath: TESTING_FILE,
    input: [
      `import {`,
      `  createConnection,`,
      `  createDatabase,`,
      `} from "@cosmicdrift/kumiko-framework/internal/stack-support";`,
      ``,
      `const admin = await createConnection(adminUrl, { maxConnections: 1 });`,
      `const conn = await createConnection(testUrl, opts.poolMax !== undefined ? { maxConnections: opts.poolMax } : {});`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection, createDatabase } from "@cosmicdrift/kumiko-framework/internal/stack-support";`,
      ``,
      `const admin = createDbConnection({ url: adminUrl, maxConnections: 1 });`,
      `const conn = createDbConnection({ url: testUrl, ...(opts.poolMax !== undefined ? { maxConnections: opts.poolMax } : {}) });`,
      ``,
    ].join("\n"),
    rewrites: 3,
    manual: 0,
  },
  {
    name: "relative db/api and createPgConnection retarget to db/connection",
    filePath: "/repo/packages/framework/src/consumer-cli.ts",
    input: [
      `import { createConnection } from "./db/api.js";`,
      `import { createPgConnection } from "./db/postgres-provider.js";`,
      `const db = await createConnection(dbUrl);`,
      `const pg = await createPgConnection(dbUrl);`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection } from "./db/connection.js";`,
      `const db = createDbConnection({ url: dbUrl });`,
      `const pg = createDbConnection({ url: dbUrl });`,
      ``,
    ].join("\n"),
    rewrites: 4,
    manual: 0,
  },
  {
    name: "a local createConnection function stays untouched",
    filePath: FRAMEWORK_FILE,
    input: [
      `async function createConnection(url: string): Promise<string> {`,
      `  return url;`,
      `}`,
      `const c = await createConnection("x");`,
      ``,
    ].join("\n"),
    expected: [
      `async function createConnection(url: string): Promise<string> {`,
      `  return url;`,
      `}`,
      `const c = await createConnection("x");`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 0,
  },
  {
    name: "merging into a later /db import keeps the declarations after it",
    filePath: CONSUMER_FILE,
    input: [
      `import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";`,
      `import { configurePiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";`,
      `import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";`,
      `export { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";`,
      ``,
    ].join("\n"),
    expected: [
      `import { configurePiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";`,
      `import { createTenantDb, fetchOne } from "@cosmicdrift/kumiko-framework/db";`,
      `export { selectMany } from "@cosmicdrift/kumiko-framework/db";`,
      ``,
    ].join("\n"),
    rewrites: 2,
    manual: 0,
  },
  {
    name: "removed connection exports and DB_PROVIDER are reported",
    filePath: CONSUMER_FILE,
    input: [
      `import { createBunDbConnection, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";`,
      `import type { DbPoolHandle } from "@cosmicdrift/kumiko-framework/db";`,
      `const provider = process.env.DB_PROVIDER;`,
      `const other = env["DB_PROVIDER"];`,
      ``,
    ].join("\n"),
    expected: [
      `import { createBunDbConnection } from "@cosmicdrift/kumiko-framework/bun-db";`,
      `import { selectMany } from "@cosmicdrift/kumiko-framework/db";`,
      `import type { DbPoolHandle } from "@cosmicdrift/kumiko-framework/db";`,
      `const provider = process.env.DB_PROVIDER;`,
      `const other = env["DB_PROVIDER"];`,
      ``,
    ].join("\n"),
    rewrites: 1,
    manual: 4,
  },
  {
    name: "destructured dynamic import binding is rewritten",
    filePath: CONSUMER_FILE,
    input: [
      `const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");`,
      `const { db, close } = createDbConnection(databaseUrl);`,
      ``,
    ].join("\n"),
    expected: [
      `const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");`,
      `const { db, close } = createDbConnection({ url: databaseUrl });`,
      ``,
    ].join("\n"),
    rewrites: 1,
    manual: 0,
  },
  {
    name: "unrelated createDbConnection is not rewritten",
    filePath: CONSUMER_FILE,
    input: [
      `import { createDbConnection } from "./my-own-db.js";`,
      `const a = createDbConnection(url);`,
      ``,
    ].join("\n"),
    expected: [
      `import { createDbConnection } from "./my-own-db.js";`,
      `const a = createDbConnection(url);`,
      ``,
    ].join("\n"),
    rewrites: 0,
    manual: 0,
  },
];

describe("db-factory codemod", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: output matches`, () => {
      const result = transformDbFactorySource(fixture.input, fixture.filePath);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(fixture.manual);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformDbFactorySource(fixture.expected, fixture.filePath);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toHaveLength(0);
    });
  }

  it("reports file and line for manual sites", () => {
    const result = transformDbFactorySource(
      `import { BunDbRunner } from "@cosmicdrift/kumiko-framework/bun-db";\nconst x = 1;\n`,
      CONSUMER_FILE,
    );

    expect(result.manual).toEqual([
      expect.objectContaining({ file: CONSUMER_FILE, line: 1, kind: "import" }),
    ]);
  });
});
