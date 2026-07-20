import { beforeEach, describe, expect, test } from "bun:test";
import type { FileStorageProvider } from "../files/types";

const bytes = (s: string) => new TextEncoder().encode(s);
const decode = (u: Uint8Array) => new TextDecoder().decode(u);

async function* fromChunks(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

// Mirrors describeKmsAdapterContract (crypto/__tests__/kms-adapter-contract.ts):
// pins the FileStorageProvider contract against whatever implementation the
// factory returns. Provider-specific behavior (error messages, buffer
// copies, multipart details) stays in each provider's dedicated tests.
export function describeFileProviderContract(
  name: string,
  factory: () => FileStorageProvider | Promise<FileStorageProvider>,
): void {
  describe(`${name} — FileStorageProvider contract`, () => {
    let provider: FileStorageProvider;

    beforeEach(async () => {
      provider = await factory();
    });

    test("write + read roundtrip preserves bytes", async () => {
      const key = `contract/${crypto.randomUUID()}.bin`;
      await provider.write(key, bytes("hello contract"));
      expect(decode(await provider.read(key))).toBe("hello contract");
    });

    test("read throws for a missing key", async () => {
      await expect(provider.read(`contract/missing-${crypto.randomUUID()}`)).rejects.toThrow();
    });

    test("exists reflects write + delete", async () => {
      const key = `contract/${crypto.randomUUID()}.txt`;
      expect(await provider.exists(key)).toBe(false);
      await provider.write(key, bytes("x"));
      expect(await provider.exists(key)).toBe(true);
      await provider.delete(key);
      expect(await provider.exists(key)).toBe(false);
    });

    test("delete on a missing key is a no-op", async () => {
      await expect(
        provider.delete(`contract/never-existed-${crypto.randomUUID()}`),
      ).resolves.toBeUndefined();
    });

    test("writeStream + readStream roundtrip preserves bytes", async () => {
      const key = `contract/${crypto.randomUUID()}.stream`;
      await provider.writeStream(key, fromChunks([bytes("foo"), bytes("bar")]));
      let out = "";
      for await (const chunk of provider.readStream(key)) out += decode(chunk);
      expect(out).toBe("foobar");
    });

    test("readStream on a missing key throws on the first chunk pull", async () => {
      const it = provider
        .readStream(`contract/missing-${crypto.randomUUID()}`)
        [Symbol.asyncIterator]();
      await expect(it.next()).rejects.toThrow();
    });

    test("getSignedUrl, when implemented, returns a URL string", async () => {
      if (!provider.getSignedUrl) return; // optional per contract — feature-detected

      const key = `contract/${crypto.randomUUID()}.txt`;
      await provider.write(key, bytes("signed"));
      const url = await provider.getSignedUrl(key, 60);
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });
  });
}
