import { afterEach, describe, expect, mock, test } from "bun:test";
import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { textBlocksClient } from "../client-plugin";

// Covers the three new migration paths (advisor gap): navId attach + SSE
// entities, no-leak without navId (conditional spread), and the unwrap (the
// provider emits the folder/leaves directly, NOT under the "Content" wrapper).
// The provider fetches → fetch is mocked.

describe("textBlocksClient — shape", () => {
  test("ohne navId: kein navProvider/navEntities (no-leak), aber Resolver bleibt", () => {
    const def = textBlocksClient();
    expect(def.name).toBe("template-resolver");
    expect(def.navProviders).toBeUndefined();
    expect(def.navEntities).toBeUndefined();
    expect(def.resolvers?.["template-resolver:edit"]).toBeDefined();
  });

  test("mit navId: Provider + SSE-Entities unter exakt dieser QN", () => {
    const navId = "publicstatus:nav:content";
    const def = textBlocksClient({ navId });
    expect(Object.keys(def.navProviders ?? {})).toEqual([navId]);
    expect(def.navEntities?.[navId]).toEqual(["template-resource"]);
  });
});

describe("textBlocksClient — Provider unwrappt den Content-Container", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("emittiert Folder/Leaves direkt, kein 'Content'-Wrapper-Knoten", async () => {
    const blocks = [
      {
        slug: "imprint",
        locale: "de",
        title: "Imprint",
        content: "x",
        folder: null,
        updatedAt: "",
      },
      { slug: "hero", locale: "de", title: "Hero", content: null, folder: "page", updatedAt: "" },
    ];
    // Test-mock boundary: bun's mock doesn't cover the full fetch signature
    // (preconnect etc.) — double-cast is deliberate, only this test calls fetch.
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ data: { blocks } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const navId = "x:nav:content";
    const provider = textBlocksClient({ navId }).navProviders?.[navId];
    if (provider === undefined) throw new Error("provider missing");

    let emitted: readonly TreeNode[] | undefined;
    provider()((nodes) => {
      emitted = nodes;
    });
    // fetch().then(...) is async → wait one macrotask until emit has run.
    await new Promise((r) => setTimeout(r, 0));

    expect(emitted).toBeDefined();
    const labels = (emitted ?? []).map((n) => n.label).sort();
    // No "Content" wrapper — root-leaf "Imprint" + folder "page" directly.
    expect(labels).not.toContain("Content");
    expect(labels).toEqual(["Imprint", "page"]);
  });
});

describe("textBlocksClient — content collections", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  const collection = (id: string, kind: string) => ({
    id,
    kind,
    nav: { label: `mail:nav.${id}` },
    navQn: `mail:nav:${id}`,
  });

  test("one provider + SSE entities per declared collection, keyed on the schema's nav QN", () => {
    const derived = textBlocksClient().navProvidersFromCollections?.([
      collection("templates", "mail-html"),
      collection("prompts", "ai-prompt"),
    ]);

    expect(Object.keys(derived?.providers ?? {}).sort()).toEqual([
      "mail:nav:prompts",
      "mail:nav:templates",
    ]);
    expect(derived?.entities?.["mail:nav:templates"]).toEqual(["template-resource"]);
  });

  test("no collections declared → nothing derived", () => {
    const derived = textBlocksClient().navProvidersFromCollections?.([]);
    expect(Object.keys(derived?.providers ?? {})).toEqual([]);
  });

  test("a collection's provider calls that collection's handler and stamps its id on the edit target", async () => {
    let sentType = "";
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        type: string;
        payload: Record<string, unknown>;
      };
      sentType = body.type;
      return new Response(
        JSON.stringify({
          data: {
            blocks: [
              {
                slug: "reminder",
                locale: "de",
                title: "Reminder",
                content: "x",
                folder: null,
                updatedAt: "",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const derived = textBlocksClient().navProvidersFromCollections?.([
      collection("templates", "mail-html"),
    ]);
    const provider = derived?.providers["mail:nav:templates"];
    if (provider === undefined) throw new Error("provider missing");

    let emitted: readonly TreeNode[] | undefined;
    provider()((nodes) => {
      emitted = nodes;
    });
    await new Promise((r) => setTimeout(r, 0));

    // The collection's own handler carries its access rule — a shared one
    // taking a kind would have to admit every collection's roles at once.
    expect(sentType).toBe("template-resolver:query:templates-list");
    // Without the collection id on the target, the editor would read and write
    // through the public text-block pair instead of this collection.
    expect(emitted?.[0]?.target?.args).toMatchObject({
      slug: "reminder",
      collectionId: "templates",
    });
  });

  test("a text-block collection also uses its own handler — declared means declared", async () => {
    let sentType = "";
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      sentType = (JSON.parse(String(init?.body)) as { type: string }).type;
      return new Response(JSON.stringify({ data: { blocks: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const derived = textBlocksClient().navProvidersFromCollections?.([
      collection("pages", "text-block"),
    ]);
    derived?.providers["mail:nav:pages"]?.()(() => {});
    await new Promise((r) => setTimeout(r, 0));

    // Same kind as the public tree, but declared as a collection → it gets the
    // access the app declared, not anonymous reach.
    expect(sentType).toBe("template-resolver:query:pages-list");
  });

  test("the hand-wired navId path stays on the anonymous-capable query", async () => {
    let sentType = "";
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      sentType = (JSON.parse(String(init?.body)) as { type: string }).type;
      return new Response(JSON.stringify({ data: { blocks: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    // publicstatus renders its content sidebar on public pages without a
    // session — that path must not move onto a collection handler.
    const navId = "publicstatus:nav:content";
    textBlocksClient({ navId }).navProviders?.[navId]?.()(() => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(sentType).toBe("template-resolver:query:by-tenant");
  });
});
