// Boot reindex: a changed search fingerprint (or a missing marker) reindexes once; two
// processes booting at the same time reindex once; an interrupted run is retried.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { deleteMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEsOperationsTable, esOperationsTable } from "@cosmicdrift/kumiko-framework/es-ops";
import {
  createInMemorySearchAdapter,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  runSearchReindexOnBoot,
  SKIP_SEARCH_REINDEX_ENV,
  searchReindexFingerprint,
  startSearchReindexOnBoot,
} from "../search-reindex-on-boot";

const TABLE = "read_boot_reindex_notes";

function noteEntityWith(noteSearchable: boolean) {
  return createEntity({
    table: TABLE,
    fields: {
      title: createTextField({
        personal: false,
        reason: "test_fixture",
        required: true,
        searchable: true,
      }),
      note: createTextField({
        personal: false,
        reason: "test_fixture",
        searchable: noteSearchable,
      }),
    },
  });
}

function featureWith(noteSearchable: boolean) {
  const entity = noteEntityWith(noteSearchable);
  return defineFeature("bootreindex", (r) => {
    r.entity({ name: "note", ...entity });
    r.writeHandler(
      defineEntityWriteHandler("note:create", entity, { access: { roles: ["Admin"] } }),
    );
  });
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [featureWith(false)] });
  await unsafeCreateEntityTable(stack.db, noteEntityWith(false), "note");
  for (const title of ["alpha", "beta", "gamma"]) {
    await stack.http.writeOk(
      "bootreindex:write:note:create",
      { title, note: `note ${title}` },
      TestUsers.admin,
    );
  }
  await createEsOperationsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await deleteMany(stack.db, esOperationsTable, { operationType: "search-reindex" });
});

type Spy = { readonly adapter: SearchAdapter; readonly indexedDocuments: () => number };

function spyAdapter(options: { readonly delayMs?: number; readonly failing?: boolean } = {}): Spy {
  const inner = createInMemorySearchAdapter();
  let indexed = 0;
  return {
    indexedDocuments: () => indexed,
    adapter: {
      ...inner,
      async indexBatch(tenantId, docs) {
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        if (options.failing) throw new Error("search backend down");
        indexed += docs.length;
        await inner.indexBatch?.(tenantId, docs);
      },
    },
  };
}

function boot(
  adapter: SearchAdapter,
  extra: { signal?: AbortSignal; registry?: typeof stack.registry } = {},
) {
  return runSearchReindexOnBoot({
    db: stack.db,
    registry: extra.registry ?? stack.registry,
    searchAdapter: adapter,
    ...(extra.signal && { signal: extra.signal }),
  });
}

describe("runSearchReindexOnBoot", () => {
  test("indexes every row once; the next boot does nothing", async () => {
    const spy = spyAdapter();
    const first = await boot(spy.adapter);
    expect(first.reindexedEntities).toEqual(["note"]);
    expect(spy.indexedDocuments()).toBe(3);

    const second = await boot(spy.adapter);
    expect(second.reindexedEntities).toEqual([]);
    expect(spy.indexedDocuments()).toBe(3);
  });

  test("two processes booting at once reindex once", async () => {
    const spy = spyAdapter({ delayMs: 300 });
    const [a, b] = await Promise.all([boot(spy.adapter), boot(spy.adapter)]);
    expect(spy.indexedDocuments()).toBe(3);
    expect([a, b].filter((o) => o.reindexedEntities.length > 0)).toHaveLength(1);
    expect([a, b].some((o) => o.skippedBecauseLocked)).toBe(true);
  });

  test("a changed set of search fields reindexes again", async () => {
    const spy = spyAdapter();
    await boot(spy.adapter);
    const widened = createRegistry([featureWith(true)]);
    expect(searchReindexFingerprint(widened, "note")).not.toBe(
      searchReindexFingerprint(stack.registry, "note"),
    );
    const outcome = await boot(spy.adapter, { registry: widened });
    expect(outcome.reindexedEntities).toEqual(["note"]);
    expect(spy.indexedDocuments()).toBe(6);
  });

  test("an aborted run leaves no marker, the next boot reindexes", async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = spyAdapter();
    const aborted = await boot(spy.adapter, { signal: controller.signal });
    expect(aborted.reindexedEntities).toEqual([]);
    expect(spy.indexedDocuments()).toBe(0);

    const retry = await boot(spy.adapter);
    expect(retry.reindexedEntities).toEqual(["note"]);
    expect(spy.indexedDocuments()).toBe(3);
  });

  test("a failing search backend leaves no marker, the next boot reindexes", async () => {
    const failed = await boot(spyAdapter({ failing: true }).adapter);
    expect(failed.failedEntities).toEqual(["note"]);
    expect(failed.reindexedEntities).toEqual([]);

    const spy = spyAdapter();
    const retry = await boot(spy.adapter);
    expect(retry.reindexedEntities).toEqual(["note"]);
    expect(spy.indexedDocuments()).toBe(3);
  });
});

describe("startSearchReindexOnBoot", () => {
  const lifecycle = () => {
    const hooks: Array<() => Promise<void>> = [];
    return {
      hooks,
      registry: {
        registerShutdownHook: (_n: string, fn: () => Promise<void>) => void hooks.push(fn),
      },
    };
  };

  test("runs in the background and finishes on shutdown", async () => {
    const spy = spyAdapter();
    const { hooks, registry } = lifecycle();
    startSearchReindexOnBoot({
      db: stack.db,
      registry: stack.registry,
      extraContext: { searchAdapter: spy.adapter },
      lifecycle: registry,
      envSource: {},
    });
    expect(hooks).toHaveLength(1);
    await hooks[0]?.();
  });

  test("the opt-out env and a missing adapter start nothing", () => {
    const { hooks, registry } = lifecycle();
    startSearchReindexOnBoot({
      db: stack.db,
      registry: stack.registry,
      extraContext: { searchAdapter: spyAdapter().adapter },
      lifecycle: registry,
      envSource: { [SKIP_SEARCH_REINDEX_ENV]: "1" },
    });
    startSearchReindexOnBoot({
      db: stack.db,
      registry: stack.registry,
      extraContext: {},
      lifecycle: registry,
      envSource: {},
    });
    expect(hooks).toHaveLength(0);
  });
});
