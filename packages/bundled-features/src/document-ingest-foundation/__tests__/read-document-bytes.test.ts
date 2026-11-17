import { describe, expect, test } from "bun:test";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { readDocumentBytes } from "../read-document-bytes.ts";

const KEY = "tenant/doc.bin";
const TEN_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

async function providerWith(bytes: Uint8Array): Promise<FileStorageProvider> {
  const provider = createInMemoryFileProvider();
  await provider.write(KEY, bytes, "application/octet-stream");
  return provider;
}

describe("readDocumentBytes", () => {
  test("returns exactly the bytes when they fit the limit", async () => {
    const result = await readDocumentBytes(await providerWith(TEN_BYTES), KEY, 10);
    expect(result).toEqual(TEN_BYTES);
  });

  test("returns too-large when the bytes exceed the limit by one", async () => {
    const result = await readDocumentBytes(await providerWith(TEN_BYTES), KEY, 9);
    expect(result).toBe("too-large");
  });

  test("stops pulling chunks once the limit is exceeded", async () => {
    let chunksPulled = 0;
    const base = await providerWith(TEN_BYTES);
    const provider: FileStorageProvider = {
      ...base,
      readStream: async function* () {
        for (let i = 0; i < 4; i++) {
          chunksPulled++;
          yield new Uint8Array(6);
        }
      },
    };

    const result = await readDocumentBytes(provider, KEY, 8);

    expect(result).toBe("too-large");
    expect(chunksPulled).toBe(2);
  });
});
