// Collections are declared at mount, each with its own access rule, and each
// gets its own handler trio. The point of the split is that the dispatcher
// enforces the separation: someone who may curate reply snippets must not
// reach the AI prompts, and neither must show up on the anonymous path that
// serves the public legal pages.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { createAnonymousUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../feature";
import {
  collectionHandlerName,
  collectionQueryName,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "../qualified-names";
import { seedTextBlock } from "../seeding";
import { type TemplateResourceRow, templateResourceEntity, templateResourcesTable } from "../table";

let stack: TestStack;
let db: DbConnection;

const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"] });
const plainUser = createTestUser({ id: 3 });
// The app's own role vocabulary — the whole reason access is declared at mount.
const agent = createTestUser({ id: 4, roles: ["Agent"] });
const promptEngineer = createTestUser({ id: 5, roles: ["PromptEngineer"] });

const SNIPPETS_LIST = collectionQueryName("reply-snippets", "list");
const SNIPPETS_ITEM = collectionQueryName("reply-snippets", "item");
const SNIPPETS_SET = collectionHandlerName("reply-snippets");
const PROMPTS_LIST = collectionQueryName("ai-prompts", "list");
const PROMPTS_SET = collectionHandlerName("ai-prompts");

const feature = createTemplateResolverFeature({
  collections: [
    {
      id: "reply-snippets",
      kind: "mail-html",
      access: { roles: ["Agent", "TenantAdmin"] },
      nav: { label: "mail:nav.snippets" },
    },
    {
      id: "ai-prompts",
      kind: "ai-prompt",
      access: { roles: ["PromptEngineer"] },
      nav: { label: "mail:nav.prompts" },
    },
  ],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  await createEventsTable(db);

  // A text-block and a snippet on the same tenant with the same slug — proves
  // the collection selects the row rather than decorating the payload.
  await seedTextBlock(db, {
    tenantId: agent.tenantId,
    slug: "welcome",
    locale: "de",
    title: "Willkommen (Text-Block)",
    content: "Statischer Text.",
  });
  await stack.http.writeOk(
    SNIPPETS_SET,
    {
      slug: "welcome",
      locale: "de",
      title: "Willkommen (Snippet)",
      content: "<p>Hallo {{name}}</p>",
      contentFormat: "html",
    },
    agent,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("collection access :: declared roles, not hardcoded admin", () => {
  test("the app's own role may read its collection", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SNIPPETS_LIST,
      {},
      agent,
    );
    expect(result.blocks.map((b) => b.title)).toEqual(["Willkommen (Snippet)"]);
  });

  test("the app's own role may write to its collection", async () => {
    const result = await stack.http.writeOk<{ isNew: boolean }>(
      SNIPPETS_SET,
      {
        slug: "thanks",
        locale: "de",
        title: "Danke",
        content: "<p>Danke für Ihre Nachricht.</p>",
        contentFormat: "html",
      },
      agent,
    );
    expect(result.isNew).toBe(true);
  });

  test("a role that may curate snippets may NOT reach the prompts", async () => {
    const error = await stack.http.queryErr(PROMPTS_LIST, {}, agent);
    expect(error.code).toBe("access_denied");
  });

  test("and may not write them either", async () => {
    const error = await stack.http.writeErr(
      PROMPTS_SET,
      { slug: "triage", locale: "de", title: "Triage", content: "x", contentFormat: "plain" },
      agent,
    );
    expect(error.code).toBe("access_denied");
  });

  test("the prompt role reaches the prompts", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      PROMPTS_LIST,
      {},
      promptEngineer,
    );
    expect(result.blocks).toEqual([]);
  });

  test("but not the snippets — the separation cuts both ways", async () => {
    const error = await stack.http.queryErr(SNIPPETS_LIST, {}, promptEngineer);
    expect(error.code).toBe("access_denied");
  });

  test("a user with no declared role reaches neither", async () => {
    expect((await stack.http.queryErr(SNIPPETS_LIST, {}, plainUser)).code).toBe("access_denied");
    expect((await stack.http.queryErr(PROMPTS_LIST, {}, plainUser)).code).toBe("access_denied");
  });

  test("anonymous reaches neither", async () => {
    const anon = createAnonymousUser(agent.tenantId);
    expect((await stack.http.queryErr(SNIPPETS_LIST, {}, anon)).code).toBe("access_denied");
    expect((await stack.http.queryErr(PROMPTS_LIST, {}, anon)).code).toBe("access_denied");
  });

  test("TenantAdmin is in the declared list for snippets, so it passes there", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      SNIPPETS_LIST,
      {},
      tenantAdmin,
    );
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  test("TenantAdmin is NOT in the prompt list, so being admin doesn't help", async () => {
    // The regression this guards: reverting to a hardcoded admin rule would
    // make this pass and quietly undo the whole point of declaring access.
    const error = await stack.http.queryErr(PROMPTS_LIST, {}, tenantAdmin);
    expect(error.code).toBe("access_denied");
  });
});

describe("collection isolation :: same slug, different collection", () => {
  test("the collection's item handler returns its own row, not the text-block", async () => {
    const snippet = await stack.http.queryOk<{ title: string }>(
      SNIPPETS_ITEM,
      { slug: "welcome", locale: "de" },
      agent,
    );
    expect(snippet.title).toBe("Willkommen (Snippet)");

    const block = await stack.http.queryOk<{ title: string }>(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de" },
      tenantAdmin,
    );
    expect(block.title).toBe("Willkommen (Text-Block)");
  });

  test("writing through the collection leaves the text-block untouched", async () => {
    await stack.http.writeOk(
      SNIPPETS_SET,
      {
        slug: "welcome",
        locale: "de",
        title: "Willkommen (Snippet, v2)",
        content: "<p>Servus</p>",
        contentFormat: "html",
      },
      agent,
    );

    const block = await stack.http.queryOk<{ title: string }>(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de" },
      tenantAdmin,
    );
    expect(block.title).toBe("Willkommen (Text-Block)");
  });

  test("creating through a collection publishes immediately — no draft stage", async () => {
    await stack.http.writeOk(
      SNIPPETS_SET,
      {
        slug: "invoice",
        locale: "de",
        title: "Rechnung",
        content: "<p>Rechnung</p>",
        contentFormat: "html",
      },
      agent,
    );

    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId: agent.tenantId,
      slug: "invoice",
      kind: "mail-html",
      locale: "de",
    });
    // The tree editor is the no-draft route; upsertTenant + publish is the one
    // that stages. Pinned because the split is easy to "fix" by accident.
    expect(row?.status).toBe("active");
    expect(row?.variableSchema).toBe("{}");
  });
});

describe("public handlers stay public and stay text-block", () => {
  test("anonymous may list text-blocks", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly { slug: string }[] }>(
      TemplateResolverQueries.byTenant,
      {},
      createAnonymousUser(agent.tenantId),
    );
    expect(result.blocks.map((b) => b.slug)).toContain("welcome");
  });

  test("a kind in the payload changes nothing — there is no such field", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      TemplateResolverQueries.byTenant,
      { kind: "mail-html" },
      createAnonymousUser(agent.tenantId),
    );
    expect(result.blocks.map((b) => b.title)).toEqual(["Willkommen (Text-Block)"]);
  });

  test("set still authors text-blocks for the hand-wired content tree", async () => {
    const result = await stack.http.writeOk<{ isNew: boolean }>(
      TemplateResolverHandlers.set,
      { slug: "imprint", locale: "de", title: "Impressum", content: "## Angaben" },
      tenantAdmin,
    );
    expect(result.isNew).toBe(true);
  });
});

describe("mount-time guard", () => {
  test("ownership 'user' is rejected until the ownerId column exists", () => {
    expect(() =>
      createTemplateResolverFeature({
        collections: [
          {
            id: "signatures",
            kind: "mail-html",
            ownership: "user",
            access: { roles: ["Agent"] },
            nav: { label: "mail:nav.signatures" },
          },
        ],
      }),
    ).toThrow(/#1770/);
  });
});
