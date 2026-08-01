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
