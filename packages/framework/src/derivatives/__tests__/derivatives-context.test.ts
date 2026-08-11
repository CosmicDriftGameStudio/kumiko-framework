import { describe, expect, test } from "bun:test";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import type { Registry } from "../../engine/types";
import { createFileContext } from "../../files/file-handle";
import { createInMemoryFileProvider } from "../../files/in-memory-provider";
import { createDerivativesContext, resolveRenderer } from "../derivatives-context";

const FILE_REF_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

// Minimal fake Registry — same pattern as provider-resolver.test.ts's
// fakeRegistry: only getExtensionUsages is exercised by resolveRenderer.
function fakeRegistry(usages: ReadonlyArray<{ entityName: string; options: unknown }>): Registry {
  return {
    getExtensionUsages: () => usages,
  } as unknown as Registry;
}

function countingRenderer(): {
  plugin: DerivativeRendererPlugin;
  calls: () => number;
} {
  let calls = 0;
  const plugin: DerivativeRendererPlugin = {
    render: async () => {
      calls++;
      return new Uint8Array([calls]);
    },
  };
  return { plugin, calls: () => calls };
}

// bun-db's fetchOne(db, table, where) duck-types `db` as a TenantDb via
// tenantDbDelegate() and, when it matches, delegates straight to
// db.selectMany(...) instead of building raw SQL — so a fake satisfying that
// shape exercises variant()'s own logic without a live Postgres connection.
// selectMany evaluates `where` against the canned row instead of ignoring
// it: variant()'s two mandatory filters (tenantId, isDeleted) are real
// integration-test territory, but a fake that returns the row unconditionally
// would let those filters be deleted here without a single red test.
function fakeDbWithFileRef(row: { storageKey: string; mimeType: string }): unknown {
  const canned: Record<string, unknown> = {
    ...row,
    id: FILE_REF_ID,
    tenantId: TENANT_ID,
    isDeleted: false,
  };
  return {
    raw: { unsafe: () => {} },
    tenantId: TENANT_ID,
    selectMany: async (_table: unknown, where?: Record<string, unknown>) => {
      const matches = Object.entries(where ?? {}).every(([key, value]) => canned[key] === value);
      return matches ? [canned] : [];
    },
    fetchOne: async () => canned,
    insertOne: async () => undefined,
    updateMany: async () => [],
    deleteMany: async () => {},
  };
}

describe("resolveRenderer", () => {
  test("exact MIME match wins over a wildcard", () => {
    const { plugin: exactPlugin } = countingRenderer();
    const { plugin: wildcardPlugin } = countingRenderer();
    const registry = fakeRegistry([
      { entityName: "image/*", options: wildcardPlugin },
      { entityName: "image/png", options: exactPlugin },
    ]);
    expect(resolveRenderer(registry, "image/png")).toBe(exactPlugin);
  });

  test("falls back to a `<type>/*` wildcard when no exact match exists", () => {
    const { plugin: wildcardPlugin } = countingRenderer();
    const registry = fakeRegistry([{ entityName: "image/*", options: wildcardPlugin }]);
    expect(resolveRenderer(registry, "image/jpeg")).toBe(wildcardPlugin);
  });

  test("no match returns undefined — caller throws with the known-list", () => {
    const registry = fakeRegistry([]);
    expect(resolveRenderer(registry, "application/pdf")).toBeUndefined();
  });

  test("a `; charset=` suffix on the source mimeType doesn't break resolution", () => {
    const { plugin } = countingRenderer();
    const registry = fakeRegistry([{ entityName: "image/jpeg", options: plugin }]);
    expect(resolveRenderer(registry, "image/jpeg; charset=binary")).toBe(plugin);
  });

  test("a registered usage without a render() throws instead of falling back to the wildcard", () => {
    const { plugin: wildcardPlugin } = countingRenderer();
    const registry = fakeRegistry([
      { entityName: "image/*", options: wildcardPlugin },
      { entityName: "image/png", options: { renderer: () => {} } },
    ]);
    expect(() => resolveRenderer(registry, "image/png")).toThrow(/image\/png/);
  });
});

describe("createDerivativesContext — variant()", () => {
  async function setup(mimeType = "image/jpeg") {
    const provider = createInMemoryFileProvider();
    await provider.write("tenant/photo.jpg", new Uint8Array([1, 2, 3]), mimeType);
    const files = createFileContext(() => Promise.resolve(provider));
    const { plugin, calls } = countingRenderer();
    const registry = fakeRegistry([{ entityName: "image/*", options: plugin }]);
    const db = fakeDbWithFileRef({ storageKey: "tenant/photo.jpg", mimeType });
    const ctx = createDerivativesContext({ files, registry, db, tenantId: TENANT_ID });
    return { ctx, calls, provider };
  }

  test("derive-on-first-use: first call renders, second call with the same spec hits the cache", async () => {
    const { ctx, calls } = await setup();
    const spec = { maxEdge: 320 } as const;

    const first = await ctx.variant(FILE_REF_ID, spec, "thumb");
    expect(first.rendered).toBe(true);
    expect(calls()).toBe(1);

    const second = await ctx.variant(FILE_REF_ID, spec, "thumb");
    expect(second.rendered).toBe(false);
    expect(calls()).toBe(1);
    expect(second.storageKey).toBe(first.storageKey);
  });

  test("a changed spec renders again at a different key", async () => {
    const { ctx, calls } = await setup();
    const first = await ctx.variant(FILE_REF_ID, { maxEdge: 320 }, "thumb");
    const second = await ctx.variant(FILE_REF_ID, { maxEdge: 640 }, "thumb");

    expect(calls()).toBe(2);
    expect(second.rendered).toBe(true);
    expect(second.storageKey).not.toBe(first.storageKey);
  });

  test("no renderer registered for the mimeType throws, naming the known patterns", async () => {
    const provider = createInMemoryFileProvider();
    await provider.write("tenant/doc.pdf", new Uint8Array([1]));
    const files = createFileContext(() => Promise.resolve(provider));
    const registry = fakeRegistry([{ entityName: "image/*", options: countingRenderer().plugin }]);
    const db = fakeDbWithFileRef({ storageKey: "tenant/doc.pdf", mimeType: "application/pdf" });
    const ctx = createDerivativesContext({ files, registry, db, tenantId: TENANT_ID });

    await expect(ctx.variant(FILE_REF_ID, {}, "thumb")).rejects.toThrow(/image\/\*/);
  });

  test("mimeType is consistent across a fresh render and a cache hit for the same spec", async () => {
    const { ctx } = await setup();
    const spec = { format: "webp" } as const;

    const first = await ctx.variant(FILE_REF_ID, spec, "thumb");
    const second = await ctx.variant(FILE_REF_ID, spec, "thumb");

    expect(first.mimeType).toBe("image/webp");
    expect(second.mimeType).toBe("image/webp");
  });

  test("the mimeType written to storage matches the mimeType returned to the caller", async () => {
    const { ctx, provider } = await setup();
    const spec = { format: "webp" } as const;

    const result = await ctx.variant(FILE_REF_ID, spec, "thumb");

    expect(provider.mimeTypeOf(result.storageKey)).toBe(result.mimeType);
    expect(result.mimeType).toBe("image/webp");
  });
});
