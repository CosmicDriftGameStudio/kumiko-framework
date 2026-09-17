// Unit-Tests fuer den verbesserten direct-entity-writes Guard.
//
// Vor dem fix-1: TX-Receiver-Namen (`tx`/`trx`/`handle`) wurden
// pauschal allowlisted. Folge: `db.transaction(async (tx) => {
//   tx.update(esTable)... })` wurde silent erlaubt obwohl es ein
// klarer ES-Bruch ist (Sub-Tx im Production-Code, kein
// projection-apply).
//
// Jetzt context-aware: enclosing function muss als arg in
// `defineApply(...)` ODER als value von `apply:`-Property in einem
// `r.projection({apply: ...})` liegen — sonst BLOCK.

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import {
  collectEntityProjectionTables,
  collectEsTables,
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

// Single-File-Setup damit ts-morph's Symbol-Resolution ohne tsconfig
// + ohne cross-file-imports klappt. createEventStoreExecutor wird
// inline declared damit collectEsTables die fooTable findet.
const SINGLE_FILE_PRELUDE = `
declare const t: unknown;
declare function createEventStoreExecutor(t: unknown, e: unknown, opts: unknown): unknown;
export const fooTable = t;
export const fooEntity = t;
export const crud = createEventStoreExecutor(fooTable, fooEntity, { entityName: "foo" });
`;

describe("collectEsTables", () => {
  test("findet fooTable als ES-Tabelle ueber den createEventStoreExecutor-Call", () => {
    const project = makeProject({ "/repo/foo.ts": SINGLE_FILE_PRELUDE });
    const tables = collectEsTables(project.getSourceFiles());
    expect(tables.size).toBe(1);
    const ids = [...tables];
    expect(ids[0]).toContain("/repo/foo.ts");
    expect(ids[0]).toContain("fooTable");
  });

  test("ignoriert Calls die nicht createEventStoreExecutor sind", () => {
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

// r.entity(name, ent) + buildEntityTable(name2, ent) verlinken über das
// geteilte `fooEntity`-Symbol, NICHT über den Namen-String (hier "foo" vs
// "foo_tbl" — bewusst verschieden, wie sessions' "user-session" vs
// "user_session"). Pinst die symbol-basierte Verlinkung.
const ENTITY_PROJECTION_PRELUDE = `
declare const t: unknown;
declare function buildEntityTable(name: string, e: unknown): unknown;
declare function updateMany(db: unknown, table: unknown, set: unknown, where: unknown): Promise<void>;
declare function insertOne(db: unknown, table: unknown, row: unknown): Promise<void>;
export const fooEntity = t;
export const fooTable = buildEntityTable("foo_tbl", fooEntity);
`;

describe("collectEntityProjectionTables", () => {
  test("verlinkt r.entity → buildEntityTable über das geteilte entity-Symbol (nicht den Namen)", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity("foo", fooEntity);
        }
      `,
    });
    const tables = collectEntityProjectionTables(project.getSourceFiles());
    expect(tables.size).toBe(1);
    expect([...tables][0]).toContain("fooTable");
  });

  test("nimmt den expliziten { table }-Override aus r.entity(name, def, { table })", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity("foo", fooEntity, { table: fooTable });
        }
      `,
    });
    expect(collectEntityProjectionTables(project.getSourceFiles()).size).toBe(1);
  });

  test("r.unmanagedTable(buildEntityTableMeta(...)) wird NICHT gesammelt — das ist der #498-Fix-Pfad", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        declare function buildEntityTableMeta(name: string, e: unknown): unknown;
        function setup(r: { unmanagedTable: (m: unknown, o: unknown) => void }) {
          r.unmanagedTable(buildEntityTableMeta("foo", fooEntity), { reason: "read_side.foo" });
        }
      `,
    });
    expect(collectEntityProjectionTables(project.getSourceFiles()).size).toBe(0);
  });
});

describe("scanDirectWrites :: function-form (bun-db helpers)", () => {
  test("BLOCK: updateMany(ctx.db, fooTable, ...) auf eine r.entity-Table (#498-sessions-Form)", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity("foo", fooEntity);
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
    expect(hits[0]?.reason).toBe("non-tx-receiver");
    expect(hits[0]?.receiver).toBe("ctx");
    expect(hits[0]?.op).toBe("update");
    expect(hits[0]?.table).toBe("fooTable");
  });

  test("ALLOW: insertOne(tx, fooTable, ...) innerhalb r.projection({apply}) — tx-Receiver im apply-Pfad", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void; projection: (def: unknown) => void }) {
          r.entity("foo", fooEntity);
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
  test("BLOCK: db.update(fooTable) im Production-Code", () => {
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
    expect(hits[0]?.reason).toBe("non-tx-receiver");
    expect(hits[0]?.receiver).toBe("db");
    expect(hits[0]?.op).toBe("update");
  });

  test("BLOCK: ctx.db.insert(fooTable) im Production-Code", () => {
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
    expect(hits[0]?.receiver).toBe("ctx");
    expect(hits[0]?.reason).toBe("non-tx-receiver");
  });
});

describe("scanDirectWrites :: tx-Receiver context-aware", () => {
  test("ALLOW: tx.insert(fooTable) innerhalb r.projection({apply: ...}) als direct value", () => {
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

  test("ALLOW: tx.insert(fooTable) innerhalb r.projection({apply: { [EVENT]: ... }}) als nested map", () => {
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

  test("BLOCK: tx.update(fooTable) innerhalb db.transaction(...) — Sub-Tx, kein apply", () => {
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
    expect(hits[0]?.reason).toBe("tx-outside-apply");
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
    expect(hits[0]?.reason).toBe("tx-outside-apply");
  });

  test("BLOCK: nested arrow innerhalb apply-projection — innerer Sub-Tx-Receiver ist nicht in TX_RECEIVER_NAMES", () => {
    // Edge-Case: arrow innerhalb apply, aber innerer Receiver heisst
    // `innerTx` (nicht in TX_RECEIVER_NAMES) → faellt unter non-tx-
    // receiver-Block. Pinst dass nur exakte tx/trx/handle-Namen
    // den apply-Pfad triggern, abweichende Namen sofort blockieren.
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
    expect(hits[0]?.reason).toBe("non-tx-receiver");
  });
});

describe("guard.run() :: entity-only repo (kein createEventStoreExecutor mehr)", () => {
  test("BLOCK auf einer r.entity-Projection-Table wird erkannt, keine Canary-Fehlmeldung (Merge-vor-Null-Check-Fix)", () => {
    const project = makeProject({
      "/repo/foo.ts": `${ENTITY_PROJECTION_PRELUDE}
        declare const db: { update: (t: unknown) => { set: (v: unknown) => { where: (w: unknown) => Promise<void> } } };
        function setup(r: { entity: (n: string, e: unknown, o?: unknown) => void }) {
          r.entity("foo", fooEntity);
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

describe("guard.run() :: empty esTables canary", () => {
  test("BLOCK: table writes present but no ES tables resolvable — misconfiguration canary fires", () => {
    const project = makeProject({
      "/repo/foo.ts": `
        declare const someTable: unknown;
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
