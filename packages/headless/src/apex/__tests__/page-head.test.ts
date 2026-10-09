import { describe, expect, jest, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { injectPageHead, resolveAndInjectPageHead } from "../index.js";

const TENANT = "00000000-0000-4000-8000-0000000000aa" as TenantId;

describe("injectPageHead", () => {
  const TAGS = '<title>New Title</title>\n<meta name="description" content="d">';

  test("replaces an existing <title> instead of duplicating it", () => {
    const html = "<html><head><title>Old</title></head><body></body></html>";
    const out = injectPageHead(html, TAGS);
    expect(out).not.toContain("<title>Old</title>");
    expect((out.match(/<title>/g) ?? []).length).toBe(1);
    expect(out).toContain("<title>New Title</title>");
  });

  test("applying twice does not duplicate the head-tags block", () => {
    const html = "<html><head><title>Old</title></head><body></body></html>";
    const once = injectPageHead(html, TAGS);
    const twice = injectPageHead(once, TAGS);
    expect(twice).toBe(once);
    expect((twice.match(/kumiko-page-head/g) ?? []).length).toBe(1);
  });

  test("HTML without </head> is returned unchanged", () => {
    const html = "<html><body><title>Old</title></body></html>";
    expect(injectPageHead(html, TAGS)).toBe(html);
  });
});

describe("resolveAndInjectPageHead", () => {
  const HTML = "<!doctype html><html><head><title>Shell</title></head><body>shell</body></html>";
  const input = { path: "/", host: "t", systemQuery: async () => ({}) };

  test("resolved meta is injected as head tags", async () => {
    const out = await resolveAndInjectPageHead(
      HTML,
      async () => ({ title: "Vehicle X", description: "A car", ogImage: "https://x/i.png" }),
      input,
    );
    expect(out).toContain("<title>Vehicle X</title>");
    expect(out).toContain('<meta property="og:image" content="https://x/i.png" />');
  });

  test("resolver throws → unchanged html, not a rejection", async () => {
    const out = await resolveAndInjectPageHead(
      HTML,
      async () => {
        throw new Error("boom");
      },
      input,
    );
    expect(out).toBe(HTML);
  });

  test("resolver returns null → unchanged html", async () => {
    const out = await resolveAndInjectPageHead(HTML, async () => null, input);
    expect(out).toBe(HTML);
  });

  test("the resolver's signal and its systemQuery signal abort once the timeout wins", async () => {
    jest.useFakeTimers();
    try {
      const seenQuerySignals: (AbortSignal | undefined)[] = [];
      let resolverSignal: AbortSignal | undefined;
      const pending = resolveAndInjectPageHead(
        HTML,
        async (resolverInput) => {
          resolverSignal = resolverInput.signal;
          await resolverInput.systemQuery("probe:query:meta", {}, TENANT);
          return new Promise(() => {});
        },
        {
          ...input,
          systemQuery: async (_type, _payload, _tenantId, options) => {
            seenQuerySignals.push(options?.signal);
            return {};
          },
        },
      );
      await Promise.resolve();
      expect(resolverSignal?.aborted).toBe(false);
      jest.advanceTimersByTime(300);
      expect(await pending).toBe(HTML);
      expect(resolverSignal?.aborted).toBe(true);
      expect(seenQuerySignals).toEqual([resolverSignal]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a client disconnect aborts the resolver's signal before the timeout", async () => {
    const request = new AbortController();
    let resolverSignal: AbortSignal | undefined;
    await resolveAndInjectPageHead(
      HTML,
      async (resolverInput) => {
        resolverSignal = resolverInput.signal;
        request.abort();
        return null;
      },
      { ...input, requestSignal: request.signal },
    );
    expect(resolverSignal?.aborted).toBe(true);
  });

  test("resolver never resolves → unchanged html after the shared timeout", async () => {
    jest.useFakeTimers();
    try {
      const pending = resolveAndInjectPageHead(HTML, () => new Promise(() => {}), input);
      jest.advanceTimersByTime(300);
      expect(await pending).toBe(HTML);
    } finally {
      jest.useRealTimers();
    }
  });
});
