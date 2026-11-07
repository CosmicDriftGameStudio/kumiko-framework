import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { buildAgentManifest, buildToolCatalog, toolNameForQn } from "../../agent-tools/index.ts";
import { HANDBOOK_PAGE_MAX_CHARS, HandbookKnowledgeQueries } from "../constants.ts";
import { createHandbookKnowledgeFeature } from "../feature.ts";

const LONG_PAGE_ID = "prozess-lang";
const LONG_PARAGRAPH = "Satz. ".repeat(400);

function page(
  id: string,
  kind: "process" | "screen",
  title: string,
  bodyMd: string,
  questions: string[] = [],
  start?: string,
) {
  return { id, kind, title, questions, screens: [], bodyMd, ...(start && { start }) };
}

const START_QN = "ai-orchestration:write:start-tenant-add";

const pages = {
  defaultLocale: "de",
  locales: {
    de: [
      page(
        "prozess-mieter",
        "process",
        "Mieter hinzufügen",
        "Änderung anlegen.",
        ["Wie füge ich einen Mieter hinzu?"],
        START_QN,
      ),
      page(LONG_PAGE_ID, "process", "Langer Ablauf", `${LONG_PARAGRAPH}\n\n`.repeat(8)),
      page("lease-detail", "screen", "Vertrag", "Maske für Verträge."),
    ],
    en: [
      page("prozess-mieter", "process", "Add a tenant", "Create a change.", [
        "How do I add a tenant?",
      ]),
    ],
  },
};

const member = createTestUser({ roles: ["Member"] });
const outsider = createTestUser({ roles: ["Other"], id: member.id, tenantId: member.tenantId });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createHandbookKnowledgeFeature({
        pages,
        access: { roles: ["Member"] },
        publicPath: "/handbuch",
      }),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

type CatalogEntry = {
  id: string;
  kind: string;
  title: string;
  questions: string[];
  start?: string;
};
type ListResult = { locale: string; pages: CatalogEntry[] };
type ReadResult = {
  id: string;
  locale: string;
  bodyMd: string;
  start?: string;
  truncated: boolean;
  notice?: string;
  publicPath?: string;
};

async function queryAs<T>(
  type: string,
  payload: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await stack.http.queryWithHeaders(type, payload, member, headers);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: T }).data;
}

describe("handbook-knowledge over real HTTP", () => {
  test("list-pages returns the catalog without page bodies in the caller's language", async () => {
    const de = await queryAs<ListResult>(
      HandbookKnowledgeQueries.listPages,
      {},
      { "X-Locale": "de" },
    );
    expect(de.pages.map((entry) => entry.id)).toEqual([
      "prozess-mieter",
      LONG_PAGE_ID,
      "lease-detail",
    ]);
    expect(de.pages[0]).toEqual({
      id: "prozess-mieter",
      kind: "process",
      title: "Mieter hinzufügen",
      questions: ["Wie füge ich einen Mieter hinzu?"],
      start: START_QN,
    });
    expect("start" in (de.pages[2] ?? {})).toBe(false);

    const en = await queryAs<ListResult>(
      HandbookKnowledgeQueries.listPages,
      {},
      { "X-Locale": "en" },
    );
    expect(en.locale).toBe("en");
    expect(en.pages[0]?.title).toBe("Add a tenant");
    expect(en.pages.map((entry) => entry.id)).toContain("lease-detail");
  });

  test("read-page serves the user's language and falls back to the default language", async () => {
    const english = await queryAs<ReadResult>(
      HandbookKnowledgeQueries.readPage,
      { id: "prozess-mieter" },
      { "X-Locale": "en-GB" },
    );
    expect(english).toMatchObject({ locale: "en", bodyMd: "Create a change.", truncated: false });

    const fallback = await queryAs<ReadResult>(
      HandbookKnowledgeQueries.readPage,
      { id: "lease-detail" },
      { "X-Locale": "en" },
    );
    expect(fallback).toMatchObject({ locale: "de", bodyMd: "Maske für Verträge." });
    expect(fallback.publicPath).toBe("/handbuch/lease-detail");
  });

  test("read-page returns the start of a page that names one and omits it otherwise", async () => {
    const withStart = await queryAs<ReadResult>(
      HandbookKnowledgeQueries.readPage,
      { id: "prozess-mieter" },
      { "X-Locale": "de" },
    );
    expect(withStart.start).toBe(START_QN);

    const without = await queryAs<ReadResult>(
      HandbookKnowledgeQueries.readPage,
      { id: "lease-detail" },
      { "X-Locale": "de" },
    );
    expect("start" in without).toBe(false);
  });

  test("read-page reports an unknown id as not_found", async () => {
    const error = await stack.http.queryErr(
      HandbookKnowledgeQueries.readPage,
      { id: "gibt-es-nicht" },
      member,
    );
    expect(error.code).toBe("not_found");
    expect(error.httpStatus).toBe(404);
  });

  test("read-page visibly cuts a page above the limit", async () => {
    const result = await queryAs<ReadResult>(
      HandbookKnowledgeQueries.readPage,
      { id: LONG_PAGE_ID },
      {},
    );
    expect(result.truncated).toBe(true);
    expect(result.bodyMd.length).toBeLessThanOrEqual(HANDBOOK_PAGE_MAX_CHARS);
    expect(result.notice).toContain(`${HANDBOOK_PAGE_MAX_CHARS} of`);
    expect(result.notice).toContain("/handbuch/prozess-lang");
  });

  test("a caller without the configured role is denied on both handlers", async () => {
    for (const [type, payload] of [
      [HandbookKnowledgeQueries.listPages, {}],
      [HandbookKnowledgeQueries.readPage, { id: "prozess-mieter" }],
    ] as const) {
      const error = await stack.http.queryErr(type, payload, outsider);
      expect(error.code).toBe("access_denied");
    }
  });
});

describe("handbook-knowledge in the agent tool catalog", () => {
  function catalogFor(roles: readonly string[]) {
    const manifest = buildAgentManifest(stack.registry, { locale: "en", roles });
    return buildToolCatalog(stack.registry, manifest, { mode: "edit" });
  }

  test("a permitted role gets both tools with description and input schema", () => {
    const tools = catalogFor(["Member"]).tools;
    for (const qn of Object.values(HandbookKnowledgeQueries)) {
      const tool = tools.find((entry) => entry.name === toolNameForQn(qn));
      expect(tool?.description).toContain("how-do-I");
      expect(tool?.inputSchema).toBeDefined();
    }
    const readTool = tools.find(
      (entry) => entry.name === toolNameForQn(HandbookKnowledgeQueries.readPage),
    );
    expect(JSON.stringify(readTool?.inputSchema)).toContain('"id"');
  });

  test("other roles do not see the tools", () => {
    const names = catalogFor(["Other"]).tools.map((tool) => tool.name);
    for (const qn of Object.values(HandbookKnowledgeQueries)) {
      expect(names).not.toContain(toolNameForQn(qn));
    }
  });
});

describe("handbook-knowledge page path with a trailing slash", () => {
  let slashStack: TestStack;

  beforeAll(async () => {
    slashStack = await setupTestStack({
      features: [
        createHandbookKnowledgeFeature({
          pages,
          access: { roles: ["Member"] },
          publicPath: "/handbuch/",
        }),
      ],
    });
  });

  afterAll(async () => {
    await slashStack.cleanup();
  });

  test("read-page joins the slashes once", async () => {
    const res = await slashStack.http.queryWithHeaders(
      HandbookKnowledgeQueries.readPage,
      { id: "lease-detail" },
      member,
      { "X-Locale": "de" },
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ReadResult };
    expect(data.publicPath).toBe("/handbuch/lease-detail");
  });
});
