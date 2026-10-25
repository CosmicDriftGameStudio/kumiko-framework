// Unit tests for the context-aware direct-entity-writes guard.
//
// Before fix-1, tx receiver names (`tx`/`trx`/`handle`) were allowlisted
// wholesale, so `db.transaction(async (tx) => { tx.update(esTable)... })`
// was silently allowed although it is a clear event-sourcing bypass (a
// sub-tx in production code, not a projection apply).
//
// Now the enclosing function must be an argument of `defineApply(...)` or the
// value of an `apply:` property in an `r.projection({apply: ...})` — else BLOCK.

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import {
  collectEntityProjectionTables,
  collectEsTables,
  collectProjectionTables,
  guard,
  scanDirectWrites,
} from "../guard-direct-entity-writes";

function makeProject(files: Record<string, string>): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [path, source] of Object.entries(files)) {
    project.createSourceFile(path, source);
  }
  return project;
}

// Single-file setup so ts-morph's symbol resolution works without a tsconfig
// and without cross-file imports. createEventStoreExecutor is declared inline
// so collectEsTables finds fooTable.
const SINGLE_FILE_PRELUDE = `
declare const t: unknown;
declare function createEventStoreExecutor(t: unknown, e: unknown, opts: unknown): unknown;
export const fooTable = t;
export const fooEntity = t;
export const crud = createEventStoreExecutor(fooTable, fooEntity, { entityName: "foo" });
`;

describe("collectEsTables", () => {
  test("finds fooTable as an ES table via the createEventStoreExecutor call", () => {
    const project = makeProject({ "/repo/foo.ts": SINGLE_FILE_PRELUDE });
    const tables = collectEsTables(project.getSourceFiles());
    expect(tables.size).toBe(1);
    const ids = [...tables];
    expect(ids[0]).toContain("/repo/foo.ts");
    expect(ids[0]).toContain("fooTable");
  });

  test("ignores calls that are not createEventStoreExecutor", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        declare const t: unknown;
        export const fooTable = t;
        declare function somethingElse(t: unknown): unknown;
        export const x = somethingElse(fooTable);
      `,
    });
    expect(collectEsTables(project.getSourceFiles()).size).toBe(0);
  });
});

// r.entity({ name, ...ent }) and buildEntityTable(name2, ent) are linked through the
// shared `fooEntity` symbol, NOT through the name string (here "foo" vs
// "foo_tbl" — deliberately different, like sessions' "user-session" vs
// "user_session"). Pins the symbol-based linking.
const ENTITY_PROJECTION_PRELUDE = `
declare const t: unknown;
declare function buildEntityTable(name: string, e: unknown): unknown;
declare function updateMany(db: unknown, table: unknown, set: unknown, where: unknown): Promise<void>;
declare function insertOne(db: unknown, table: unknown, row: unknown): Promise<void>;
export const fooEntity = t;
export const fooTable = buildEntityTable("foo_tbl", fooEntity);
`;

describe("collectEntityProjectionTables", () => {
  test("links r.entity → buildEntityTable via the shared entity symbol (not the name)", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity({ name: "foo", ...fooEntity });
        }
      `,
    });
    const tables = collectEntityProjectionTables(project.getSourceFiles());
    expect(tables.size).toBe(1);
    expect([...tables][0]).toContain("fooTable");
  });

  test("removes the explicit backingTable override from r.entity({ name, ...def, backingTable })", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity({ name: "foo", ...fooEntity, backingTable: fooTable });
        }
      `,
    });
    expect(collectEntityProjectionTables(project.getSourceFiles()).size).toBe(1);
  });

  test("r.unmanagedTable(deriveEntityTableMeta(...)) is NOT collected — this is the fix path", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        declare function deriveEntityTableMeta(name: string, e: unknown): unknown;
        function setup(r: { unmanagedTable: (m: unknown, o: unknown) => void }) {
          r.unmanagedTable(deriveEntityTableMeta("foo", fooEntity), { reason: "read_side.foo" });
        }
      `,
    });
    expect(collectEntityProjectionTables(project.getSourceFiles()).size).toBe(0);
  });
});

describe("entity registration name forms", () => {
  const registrations = {
    "constant name": "r.entity({ name: FOO_NAME, ...fooEntity });",
    "shorthand name": "const name = 'foo'; r.entity({ name, ...fooEntity });",
    "string name": 'r.entity({ name: "foo", ...fooEntity });',
  };
  for (const [label, call] of Object.entries(registrations)) {
    test(`collects the table for ${label}`, () => {
      const project = makeProject({
        "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
          declare const FOO_NAME: string;
          function setup(r: { entity: (n: unknown) => void }) { ${call} }
        `,
      });
      expect(collectEntityProjectionTables(project.getSourceFiles()).size).toBe(1);
    });
  }

  test("ignores an .entity() call without a name property", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: unknown) => void }) { r.entity({ ...fooEntity }); }
      `,
    });
    expect(collectEntityProjectionTables(project.getSourceFiles()).size).toBe(0);
  });
});

describe("scanDirectWrites :: function-form (bun-db helpers)", () => {
  test("receiver text is whitespace-free and capped", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity({ name: "foo", ...fooEntity });
        }
        async function bad(ctx: { db: unknown }) {
          await insertOne(
            ctx
              .db,
            fooTable,
            {},
          );
        }
      `,
    });
    const esTables = collectEntityProjectionTables(project.getSourceFiles());
    const hits = scanDirectWrites(project.getSourceFileOrThrow("/repo/foo.ts"), esTables);
    expect(hits[0]?.receiver).toBe("ctx.db");
  });

  test("BLOCK: updateMany(ctx.db, fooTable, ...) on an r.entity table", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity({ name: "foo", ...fooEntity });
        }
        async function bad(ctx: { db: unknown }) {
          await updateMany(ctx.db, fooTable, { authorId: null }, { id: "x" });
        }
      `,
    });
    const esTables = collectEntityProjectionTables(project.getSourceFiles());
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, esTables);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("non-tx-receiver");
    expect(hits[0]?.receiver).toBe("ctx.db");
    expect(hits[0]?.op).toBe("update");
    expect(hits[0]?.table).toBe("fooTable");
  });

  test("ALLOW: insertOne(tx, fooTable, ...) inside r.projection({apply}) — tx receiver in the apply path", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void; projection: (def: unknown) => void }) {
          r.entity({ name: "foo", ...fooEntity });
          r.projection({
            name: "foo-proj",
            apply: async (event: { payload: unknown }, tx: unknown) => {
              await insertOne(tx, fooTable, event.payload);
            },
          });
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEntityProjectionTables(project.getSourceFiles()));
    expect(hits).toHaveLength(0);
  });
});

describe("scanDirectWrites :: non-tx-receiver", () => {
  test("BLOCK: db.update(fooTable) in production code", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        async function bad(db: { update: (t: unknown) => { set: (v: unknown) => Promise<void> } }) {
          await db.update(fooTable).set({ name: "x" });
        }
      `,
    });
    const esTables = collectEsTables(project.getSourceFiles());
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, esTables);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("non-tx-receiver");
    expect(hits[0]?.receiver).toBe("db");
    expect(hits[0]?.op).toBe("update");
  });

  test("BLOCK: ctx.db.insert(fooTable) in production code", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        async function bad(ctx: { db: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } } }) {
          await ctx.db.insert(fooTable).values({ name: "x" });
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.receiver).toBe("ctx.db");
    expect(hits[0]?.kind).toBe("non-tx-receiver");
  });
});

describe("scanDirectWrites :: files and arguments that name no ES table", () => {
  test("ALLOW: a file that never mentions an ES table name has no hits", () => {
    const project = makeProject({
      "/repo/foo.ts": SINGLE_FILE_PRELUDE,
      "/repo/other.ts": `
        declare const barTable: unknown;
        declare const db: { delete: (t: unknown) => Promise<void> };
        export const run = () => db.delete(barTable);
      `,
    });
    const esTables = collectEsTables(project.getSourceFiles());
    expect(scanDirectWrites(project.getSourceFileOrThrow("/repo/other.ts"), esTables)).toEqual([]);
  });

  test("BLOCK: only the ES-table write is reported next to map.delete and a non-ES table write", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        declare const barTable: unknown;
        declare const db: { delete: (t: unknown) => Promise<void> };
        const seen = new Map<string, number>();
        export async function mixed(key: string) {
          seen.delete(key);
          await db.delete(barTable);
          await db.delete(fooTable);
        }
      `,
    });
    const esTables = collectEsTables(project.getSourceFiles());
    const hits = scanDirectWrites(project.getSourceFileOrThrow("/repo/foo.ts"), esTables);
    expect(hits.map((h) => h.table)).toEqual(["fooTable"]);
  });

  test("BLOCK: a cast-wrapped ES table argument is still resolved", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        declare const db: { delete: (t: unknown) => Promise<void> };
        export const run = () => db.delete(fooTable as unknown);
      `,
    });
    const esTables = collectEsTables(project.getSourceFiles());
    const hits = scanDirectWrites(project.getSourceFileOrThrow("/repo/foo.ts"), esTables);
    expect(hits).toHaveLength(1);
  });
});

describe("scanDirectWrites :: tx-Receiver context-aware", () => {
  test("ALLOW: tx.insert(fooTable) inside r.projection({apply: ...}) as a direct value", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        function setup(r: { projection: (def: unknown) => void }) {
          r.projection({
            name: "foo-proj",
            apply: async (event: { payload: { name: string } }, tx: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } }) => {
              await tx.insert(fooTable).values({ name: event.payload.name });
            },
          });
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits).toHaveLength(0);
  });

  test("ALLOW: tx.insert(fooTable) inside r.projection({apply: { [EVENT]: ... }}) as a nested map", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        function setup(r: { projection: (def: unknown) => void }) {
          r.projection({
            name: "foo-proj",
            apply: {
              "foo.created": async (event: { payload: { name: string } }, tx: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } }) => {
                await tx.insert(fooTable).values({ name: event.payload.name });
              },
            },
          });
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits).toHaveLength(0);
  });

  test("ALLOW: tx.update(fooTable) innerhalb defineApply(...)", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        declare function defineApply<T>(fn: (event: T, tx: { update: (t: unknown) => { set: (v: unknown) => Promise<void> } }) => Promise<void>): unknown;
        const apply = defineApply(async (event: { payload: { name: string } }, tx) => {
          await tx.update(fooTable).set({ name: event.payload.name });
        });
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits).toHaveLength(0);
  });

  test("BLOCK: tx.update(fooTable) inside db.transaction(...) — sub-tx, not apply", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        async function bad(db: { transaction: (fn: (tx: { update: (t: unknown) => { set: (v: unknown) => Promise<void> } }) => Promise<void>) => Promise<void> }) {
          await db.transaction(async (tx) => {
            await tx.update(fooTable).set({ name: "x" });
          });
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("tx-outside-apply");
    expect(hits[0]?.receiver).toBe("tx");
  });

  test("BLOCK: tx.delete(fooTable) in einer beliebigen Helper-Funktion", () => {
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        async function helper(tx: { delete: (t: unknown) => Promise<void> }) {
          await tx.delete(fooTable);
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("tx-outside-apply");
  });

  test("BLOCK: nested arrow inside apply-projection — inner sub-tx receiver is not in TX_RECEIVER_NAMES", () => {
    // Edge case: arrow inside apply, but the inner receiver is named
    // `innerTx` (not in TX_RECEIVER_NAMES) → falls under the non-tx-receiver
    // block. Pins that only the exact tx/trx/handle names trigger the apply
    // path; any other name is blocked immediately.
    const project = makeProject({
      "/repo/foo.ts": `${SINGLE_FILE_PRELUDE}
        function setup(r: { projection: (def: unknown) => void }) {
          r.projection({
            name: "foo-proj",
            apply: async (event: unknown, tx: { raw: { transaction: (fn: (innerTx: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } }) => Promise<void>) => Promise<void> } }) => {
              await tx.raw.transaction(async (innerTx) => {
                await innerTx.insert(fooTable).values({ name: "nested" });
              });
            },
          });
        }
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectEsTables(project.getSourceFiles()));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.receiver).toBe("innerTx");
    expect(hits[0]?.kind).toBe("non-tx-receiver");
  });
});

describe("scanDirectWrites :: table argument wrapped in casts", () => {
  const SETUP = `
    function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
      r.entity({ name: "foo", ...fooEntity });
    }
    declare function deleteMany(db: unknown, table: unknown, where: unknown): Promise<void>;
    declare const tables: { foo: unknown };
    declare const db: { delete: (t: unknown) => void };
  `;

  function hitsFor(body: string, path = "/repo/foo.ts") {
    const project = makeProject({
      [path]: `${ENTITY_PROJECTION_PRELUDE}${SETUP}${body}`,
    });
    const esTables = collectEntityProjectionTables(project.getSourceFiles());
    return scanDirectWrites(project.getSourceFileOrThrow(path), esTables);
  }

  test("BLOCK: cast-wrapped table arg is unwrapped and checked like a plain identifier", () => {
    for (const wrapped of [
      "fooTable as unknown",
      "(fooTable)",
      "fooTable!",
      "fooTable satisfies unknown",
      "<unknown>fooTable",
    ]) {
      const hits = hitsFor(`async function bad() { await deleteMany(db, ${wrapped}, {}); }`);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.kind).toBe("non-tx-receiver");
    }
  });

  test("ALLOW: a computed table arg stays unresolved and is skipped", () => {
    expect(hitsFor(`async function ok() { await deleteMany(db, tables.foo, {}); }`)).toHaveLength(
      0,
    );
    expect(hitsFor(`function ok() { db.delete(tables.foo as unknown); }`)).toHaveLength(0);
  });
});

describe("guard.run() :: entity-only repository (no createEventStoreExecutor anymore)", () => {
  test("BLOCK on an r.entity projection table is detected, no canary false positive (merge-before-null-check fix)", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        declare const db: { update: (t: unknown) => { set: (v: unknown) => { where: (w: unknown) => Promise<void> } } };
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity({ name: "foo", ...fooEntity });
        }
        export async function directWrite() {
          await db.update(fooTable).set({ name: "x" }).where({});
        }
      `,
    });
    const outcome = guard.run(project.getSourceFiles());
    expect(
      outcome.violations.some((v) => v.message.includes("BLOCKED: guard found table writes")),
    ).toBe(false);
    expect(outcome.violations.length).toBeGreaterThan(0);
  });
});

describe("guard.run() :: scope without own ES tables", () => {
  test("a write on a catalog table of an installed package is a finding, not the canary", () => {
    const project = makeProject({
      "/repo/consumer.ts": `
        import { listedTable } from "/node_modules/@x/pkg/src/t";
        export async function bad(db: { insert: (t: unknown) => unknown }) { db.insert(listedTable); }
      `,
    });
    const host = project.getFileSystem();
    host.writeFileSync("/node_modules/@x/pkg/package.json", "{}");
    host.writeFileSync(
      "/node_modules/@x/pkg/kumiko-es-tables.json",
      JSON.stringify([{ module: "t", export: "listedTable" }]),
    );
    host.writeFileSync("/node_modules/@x/pkg/src/t.ts", "export const listedTable = {};");
    const violations = guard.run(project.getSourceFiles()).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("non-tx-receiver");
    expect(violations.some((v) => v.message.includes("BLOCKED"))).toBe(false);
  });
});

describe("guard.run() :: empty esTables canary", () => {
  test("BLOCK: table writes present but no ES tables resolvable — misconfiguration canary fires", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        declare function pgTable(name: string, cols: unknown): unknown;
        const someTable = pgTable("some", {});
        declare const db: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } };
        export async function write() {
          await db.insert(someTable).values({ name: "x" });
        }
      `,
    });
    const outcome = guard.run(project.getSourceFiles());
    expect(
      outcome.violations.some((v) => v.message.includes("BLOCKED: guard found table writes")),
    ).toBe(true);
  });

  test("BLOCK: function-form updateMany(db, someTable, ...) without ES tables fires the canary too", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        declare function pgTable(name: string, cols: unknown): unknown;
        declare function updateMany(db: unknown, table: unknown, set: unknown, where: unknown): Promise<void>;
        const someTable = pgTable("some", {});
        declare const db: unknown;
        export async function write() {
          await updateMany(db, someTable, {}, {});
        }
      `,
    });
    const outcome = guard.run(project.getSourceFiles());
    expect(
      outcome.violations.some((v) => v.message.includes("BLOCKED: guard found table writes")),
    ).toBe(true);
  });

  test("BLOCK: table declarations present but write resolution finds nothing (tables.x access) — canary must not go green", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        declare function pgTable(name: string, cols: unknown): unknown;
        export const tables = { someTable: pgTable("some", {}) };
        declare const db: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } };
        export async function write() {
          await db.insert(tables.someTable).values({ name: "x" });
        }
      `,
    });
    const outcome = guard.run(project.getSourceFiles());
    expect(
      outcome.violations.some((v) => v.message.includes("BLOCKED: guard found table writes")),
    ).toBe(true);
  });

  test("ALLOW: map.delete(key) / set.delete(id) are not table writes — no canary in a no-ES repo", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        const cache = new Map<string, number>();
        const seen = new Set<string>();
        export function evict(key: string, id: string) {
          cache.delete(key);
          seen.delete(id);
        }
      `,
    });
    const outcome = guard.run(project.getSourceFiles());
    expect(outcome.violations).toHaveLength(0);
  });

  test("ALLOW: no ES tables and no table writes at all — repo has no event store (kumiko-platform case)", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        declare const fooTable: unknown;
        declare function somethingElse(t: unknown): unknown;
        export const x = somethingElse(fooTable);
      `,
    });
    const outcome = guard.run(project.getSourceFiles());
    expect(outcome.violations).toHaveLength(0);
  });
});

describe("scanDirectWrites :: tables imported from another file", () => {
  const DEFINITION = `${SINGLE_FILE_PRELUDE}
    export const plainTable = t;
  `;
  const WRITE_DB = "db: { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } }";

  function hitsInConsumer(files: Record<string, string>) {
    const project = makeProject(files);
    const esTables = collectEsTables(project.getSourceFiles());
    return scanDirectWrites(project.getSourceFileOrThrow("/repo/consumer.ts"), esTables);
  }

  test("BLOCK: named import of an ES table", () => {
    const hits = hitsInConsumer({
      "/repo/foo.ts": DEFINITION,
      "/repo/consumer.ts": `
        import { fooTable } from "./foo";
        export async function bad(${WRITE_DB}) { await db.insert(fooTable).values({}); }
      `,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.table).toBe("fooTable");
  });

  test("BLOCK: renamed import of an ES table", () => {
    const hits = hitsInConsumer({
      "/repo/foo.ts": DEFINITION,
      "/repo/consumer.ts": `
        import { fooTable as t } from "./foo";
        export async function bad(${WRITE_DB}) { await db.insert(t).values({}); }
      `,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.table).toBe("t");
  });

  test("BLOCK: ES table re-exported under a new name through a barrel", () => {
    const hits = hitsInConsumer({
      "/repo/foo.ts": DEFINITION,
      "/repo/barrel.ts": `export { fooTable as barTable } from "./foo";`,
      "/repo/consumer.ts": `
        import { barTable } from "./barrel";
        export async function bad(${WRITE_DB}) { await db.insert(barTable).values({}); }
      `,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.table).toBe("barTable");
  });

  test("ALLOW: a same-named parameter that is not the ES table", () => {
    const hits = hitsInConsumer({
      "/repo/foo.ts": DEFINITION,
      "/repo/consumer.ts": `
        export async function ok(fooTable: unknown, ${WRITE_DB}) { await db.insert(fooTable).values({}); }
      `,
    });
    expect(hits).toHaveLength(0);
  });

  test("ALLOW: a same-named local variable that is not the ES table", () => {
    const hits = hitsInConsumer({
      "/repo/foo.ts": DEFINITION,
      "/repo/consumer.ts": `
        declare const other: unknown;
        export async function ok(${WRITE_DB}) {
          const fooTable = other;
          await db.insert(fooTable).values({});
        }
      `,
    });
    expect(hits).toHaveLength(0);
  });

  test("ALLOW: imported table that is not event-sourced", () => {
    const hits = hitsInConsumer({
      "/repo/foo.ts": DEFINITION,
      "/repo/consumer.ts": `
        import { plainTable } from "./foo";
        export async function ok(${WRITE_DB}) { await db.insert(plainTable).values({}); }
      `,
    });
    expect(hits).toHaveLength(0);
  });
});

describe("scanDirectWrites :: tables from external packages (catalog)", () => {
  const CATALOG = JSON.stringify([{ module: "t", export: "listedTable" }]);

  function externalHits(packageFiles: Record<string, string>, importFrom: string, table: string) {
    const project = makeProject({
      "/repo/consumer.ts": `
        import { ${table} } from "${importFrom}";
        export async function bad(db: { insert: (t: unknown) => unknown }) { db.insert(${table}); }
      `,
    });
    for (const [file, text] of Object.entries(packageFiles)) {
      project.getFileSystem().writeFileSync(file, text);
    }
    const consumer = project.getSourceFileOrThrow("/repo/consumer.ts");
    return scanDirectWrites(consumer, new Set());
  }

  const SOURCE_PACKAGE = {
    "/node_modules/@x/pkg/package.json": "{}",
    "/node_modules/@x/pkg/kumiko-es-tables.json": CATALOG,
    "/node_modules/@x/pkg/src/t.ts": "export const listedTable = {}; export const otherTable = {};",
  };
  const PUBLISHED_PACKAGE = {
    "/node_modules/@x/pkg/package.json": "{}",
    "/node_modules/@x/pkg/kumiko-es-tables.json": CATALOG,
    "/node_modules/@x/pkg/dist/t.d.ts":
      "export declare const listedTable: {}; export declare const otherTable: {};",
  };

  test("BLOCK: catalog table resolved to a package src path", () => {
    const hits = externalHits(SOURCE_PACKAGE, "/node_modules/@x/pkg/src/t", "listedTable");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.table).toBe("listedTable");
  });

  test("BLOCK: catalog table resolved to a published dist .d.ts path", () => {
    const hits = externalHits(PUBLISHED_PACKAGE, "/node_modules/@x/pkg/dist/t", "listedTable");
    expect(hits).toHaveLength(1);
  });

  test("ALLOW: external table that is not in the catalog", () => {
    expect(externalHits(SOURCE_PACKAGE, "/node_modules/@x/pkg/src/t", "otherTable")).toHaveLength(
      0,
    );
  });

  test("ALLOW: package without a catalog", () => {
    const { "/node_modules/@x/pkg/kumiko-es-tables.json": _omitted, ...withoutCatalog } =
      SOURCE_PACKAGE;
    expect(externalHits(withoutCatalog, "/node_modules/@x/pkg/src/t", "listedTable")).toHaveLength(
      0,
    );
  });
});

describe("guard.run :: ES table catalog of the owning repo", () => {
  const OWNER_FILES = {
    "/repo/pkg/package.json": "{}",
    "/repo/pkg/src/foo.ts": SINGLE_FILE_PRELUDE,
  };

  function catalogOutcome(catalog: string | undefined) {
    const project = makeProject(OWNER_FILES);
    const host = project.getFileSystem();
    for (const [file, text] of Object.entries(OWNER_FILES)) host.writeFileSync(file, text);
    if (catalog !== undefined) host.writeFileSync("/repo/pkg/kumiko-es-tables.json", catalog);
    return guard.run(project.getSourceFiles()).violations;
  }

  test("up to date catalog: no finding", () => {
    const catalog = JSON.stringify([{ module: "foo", export: "fooTable" }]);
    expect(catalogOutcome(catalog)).toHaveLength(0);
  });

  test("missing catalog: finding with the rewrite command", () => {
    const violations = catalogOutcome(undefined);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("missing: foo::fooTable");
    expect(violations[0]?.message).toContain("--write-baseline");
  });

  test("rewrite command uses the installed bin, not a framework-internal path", () => {
    const message = catalogOutcome(undefined)[0]?.message ?? "";
    expect(message).toContain("kumiko-guards guards --write-baseline");
    expect(message).not.toContain("packages/guards");
  });

  test("stale catalog: finding names the surplus entry", () => {
    const stale = JSON.stringify([
      { module: "foo", export: "fooTable" },
      { module: "gone", export: "goneTable" },
    ]);
    const violations = catalogOutcome(stale);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("surplus: gone::goneTable");
  });

  test("writeBaseline writes the catalog the check then accepts", () => {
    const project = makeProject(OWNER_FILES);
    const host = project.getFileSystem();
    for (const [file, text] of Object.entries(OWNER_FILES)) host.writeFileSync(file, text);
    guard.writeBaseline?.(project.getSourceFiles());
    expect(host.readFileSync("/repo/pkg/kumiko-es-tables.json")).toContain('"fooTable"');
    expect(guard.run(project.getSourceFiles()).violations).toHaveLength(0);
  });
});

describe("r.projection tables", () => {
  const PROJECTION_PRELUDE = `
    declare const t: unknown;
    declare function buildEntityTable(name: string, e: unknown): unknown;
    export const fooProjectionTable = buildEntityTable("foo", t);
    declare const r: { projection: (d: unknown) => void };
    r.projection({ name: "foo", table: fooProjectionTable, apply: {} });
  `;

  test("collectProjectionTables finds the table of r.projection", () => {
    const project = makeProject({ "/repo/foo.ts": PROJECTION_PRELUDE });
    expect([...collectProjectionTables(project.getSourceFiles())]).toEqual([
      "/repo/foo.ts::fooProjectionTable",
    ]);
  });

  test("BLOCK: write outside the apply; ALLOW: tx write inside the apply", () => {
    const project = makeProject({
      "/repo/foo.ts": `${PROJECTION_PRELUDE}
        export async function sweep(db: { delete: (t: unknown) => unknown }) {
          db.delete(fooProjectionTable);
        }
        declare const r2: { projection: (d: unknown) => void };
        declare const tx: { insert: (t: unknown) => unknown };
        r2.projection({ name: "x", table: fooProjectionTable, apply: (event: unknown, tx: { insert: (t: unknown) => unknown }) => { tx.insert(fooProjectionTable); } });
      `,
    });
    const sf = project.getSourceFileOrThrow("/repo/foo.ts");
    const hits = scanDirectWrites(sf, collectProjectionTables(project.getSourceFiles()));
    expect(hits.map((hit) => hit.receiver)).toEqual(["db"]);
  });
});
