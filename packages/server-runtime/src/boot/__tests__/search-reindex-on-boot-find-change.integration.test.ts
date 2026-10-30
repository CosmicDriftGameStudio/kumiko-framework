// A field switched from find "none" to "fuzzy" changes the entity's search fingerprint: the next
// boot reindexes, widens the stored Meilisearch settings and existing rows become findable by it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolveBaseDbAndSearchAdapter } from "@cosmicdrift/kumiko-framework/api";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createLongTextField,
  createRegistry,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { createMeilisearchAdapter } from "@cosmicdrift/kumiko-framework/search/meilisearch";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { runSearchReindexOnBoot } from "../search-reindex-on-boot";

const MEILI_URL = process.env["MEILI_URL"] ?? "http://localhost:17700";
const MEILI_KEY = process.env["MEILI_MASTER_KEY"] ?? "kumiko-dev-key";

async function meiliAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${MEILI_URL}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const MEILI_UP = await meiliAvailable();
if (!MEILI_UP && process.env["REQUIRE_MEILI"] === "1") {
  throw new Error(`REQUIRE_MEILI=1 but Meilisearch not reachable at ${MEILI_URL}`);
}

function memoEntityWith(bodyFind: "none" | "fuzzy") {
  return createEntity({
    table: "read_find_change_memos",
    fields: {
      title: createTextField({
        personal: false,
        reason: "test_fixture",
        required: true,
        searchable: true,
      }),
      body: createLongTextField({ personal: "tenant", find: bodyFind }),
    },
  });
}

function featureWith(bodyFind: "none" | "fuzzy") {
  const entity = memoEntityWith(bodyFind);
  return defineFeature("findchange", (r) => {
    r.entity({ name: "memo", ...entity });
    r.writeHandler(
      defineEntityWriteHandler("memo:create", entity, { access: { roles: ["Admin"] } }),
    );
  });
}

describe.skipIf(!MEILI_UP)("boot reindex after find none -> fuzzy", () => {
  const indexPrefix = `test_${crypto.randomUUID()}_`;
  const tenantId = TestUsers.admin.tenantId;
  let stack: TestStack;
  const adapters: SearchAdapter[] = [];

  beforeAll(async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    stack = await setupTestStack({ features: [featureWith("none")] });
    await unsafeCreateEntityTable(stack.db, memoEntityWith("none"), "memo");
  });

  afterAll(async () => {
    await adapters[0]?.dropAllIndexes?.();
    await stack.cleanup();
    resetPiiSubjectKmsForTests();
  });

  // One process start: a fresh adapter gets the registry-derived default config the way
  // startSearchReindexOnBoot hands it over, then the boot reindex runs.
  async function bootWith(registry: typeof stack.registry) {
    const adapter = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix });
    adapters.push(adapter);
    resolveBaseDbAndSearchAdapter({ searchAdapter: adapter }, registry);
    const outcome = await runSearchReindexOnBoot({
      db: stack.db,
      registry,
      searchAdapter: adapter,
    });
    return { adapter, outcome };
  }

  async function hits(adapter: SearchAdapter, term: string): Promise<string[]> {
    return (await adapter.search(tenantId, term, { filterType: "memo" })).map((hit) =>
      String(hit.entityId),
    );
  }

  test("an existing row is found by the newly fuzzy field after the restart", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "findchange:write:memo:create",
      { title: "Quarterly report", body: "The heatingcostnote for the second floor" },
      TestUsers.admin,
    );

    const before = await bootWith(stack.registry);
    expect(before.outcome.reindexedEntities).toEqual(["memo"]);
    expect(await hits(before.adapter, "quarterly")).toEqual([id]);
    expect(await hits(before.adapter, "heatingcostnote")).toEqual([]);

    const after = await bootWith(createRegistry([featureWith("fuzzy")]));
    expect(after.outcome.reindexedEntities).toEqual(["memo"]);
    expect(await hits(after.adapter, "heatingcostnote")).toEqual([id]);
  });
});
