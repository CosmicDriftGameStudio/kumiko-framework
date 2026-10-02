import { describe, expect, mock, test } from "bun:test";
import type { Registry } from "../../engine/types/index.js";
import { makeFileProviderResolver } from "../provider-resolver.js";
import type { FileStorageProvider } from "../types.js";

const fakeProvider: FileStorageProvider = {
  write: async () => {},
  writeStream: async () => {},
  read: async () => new Uint8Array(),
  readStream: async function* () {},
  delete: async () => {},
  exists: async () => false,
  list: async () => [],
};

function fakeRegistry(): Registry {
  return {
    getExtensionUsages: () => [
      {
        entityName: "fake",
        options: { build: async () => fakeProvider },
      },
    ],
  } as unknown as Registry;
}

// 698/2: resolveProvider must not re-read config + secrets on every call —
// the provider is effectively static per tenant for the process lifetime.
describe("makeFileProviderResolver — per-tenant cache", () => {
  test("a second resolve for the same tenant reuses the cached build, doesn't call configAccessorFactory again", async () => {
    const configAccessorFactory = mock(() => async (_key: unknown) => "fake");
    const resolver = makeFileProviderResolver({
      registry: fakeRegistry(),
      _configAccessorFactory: configAccessorFactory,
      db: {} as never,
    });

    const first = await resolver("tenant-a" as never);
    const second = await resolver("tenant-a" as never);

    expect(first).toBe(fakeProvider);
    expect(second).toBe(fakeProvider);
    expect(configAccessorFactory).toHaveBeenCalledTimes(1);
  });

  test("different tenants get independent cache entries", async () => {
    const configAccessorFactory = mock(() => async (_key: unknown) => "fake");
    const resolver = makeFileProviderResolver({
      registry: fakeRegistry(),
      _configAccessorFactory: configAccessorFactory,
      db: {} as never,
    });

    await resolver("tenant-a" as never);
    await resolver("tenant-b" as never);

    expect(configAccessorFactory).toHaveBeenCalledTimes(2);
  });

  test("a rejected build is evicted — the next call retries instead of staying poisoned", async () => {
    let calls = 0;
    const resolver = makeFileProviderResolver({
      registry: {
        getExtensionUsages: () => {
          calls++;
          if (calls === 1) throw new Error("transient failure");
          return [{ entityName: "fake", options: { build: async () => fakeProvider } }];
        },
      } as unknown as Registry,
      _configAccessorFactory: () => async (_key: unknown) => "fake",
      db: {} as never,
    });

    await expect(resolver("tenant-a" as never)).rejects.toThrow("transient failure");
    const second = await resolver("tenant-a" as never);
    expect(second).toBe(fakeProvider);
  });

  test("a plugin whose built provider lacks list() fails loud instead of surfacing as a bucket-permission error later", async () => {
    const { list: _omitted, ...withoutList } = fakeProvider;
    const resolver = makeFileProviderResolver({
      registry: {
        getExtensionUsages: () => [
          { entityName: "fake", options: { build: async () => withoutList } },
        ],
      } as unknown as Registry,
      _configAccessorFactory: () => async (_key: unknown) => "fake",
      db: {} as never,
    });

    await expect(resolver("tenant-a" as never)).rejects.toThrow("required method list()");
  });
});
