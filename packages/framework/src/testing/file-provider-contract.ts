import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
    // Self-cleaning: every key this contract creates gets deleted in
    // afterEach, so a persistent backend (local `kumiko dev` against a
    // long-lived Minio, as opposed to CI's ephemeral one) doesn't leak
    // `contract/<uuid>` objects into the next developer's session. delete()
    // on a key that was never actually written is covered by the
    // "no-op on a missing key" contract test above, so tracking generated
    // keys unconditionally (even ones a test never got around to writing)
    // is safe.
    let writtenKeys: string[];

    function trackedKey(ext: string): string {
      const key = `contract/${crypto.randomUUID()}.${ext}`;
      writtenKeys.push(key);
      return key;
    }

    beforeEach(async () => {
      provider = await factory();
      writtenKeys = [];
    });

    afterEach(async () => {
      for (const key of writtenKeys) await provider.delete(key);
    });

    test("write + read roundtrip preserves bytes", async () => {
      const key = trackedKey("bin");
      await provider.write(key, bytes("hello contract"));
      expect(decode(await provider.read(key))).toBe("hello contract");
    });

    test("write on an existing key overwrites it (last-write-wins)", async () => {
      const key = trackedKey("bin");
      await provider.write(key, bytes("first"));
      await provider.write(key, bytes("second"));
      expect(decode(await provider.read(key))).toBe("second");
    });

    test("read throws for a missing key", async () => {
      await expect(provider.read(`contract/missing-${crypto.randomUUID()}`)).rejects.toThrow();
    });

    test("exists reflects write + delete", async () => {
      const key = trackedKey("txt");
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
      const key = trackedKey("stream");
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
      // skip: getSignedUrl is optional on the contract — feature-detected
      if (!provider.getSignedUrl) return;

      const key = trackedKey("txt");
      await provider.write(key, bytes("signed"));
      const url = await provider.getSignedUrl(key, 60);
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });
  });
}
