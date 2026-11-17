import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";

// The limit applies to the bytes actually read, not to the declared size.
export async function readDocumentBytes(
  storage: FileStorageProvider,
  storageKey: string,
  maxBytes: number,
): Promise<Uint8Array | "too-large"> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of storage.readStream(storageKey)) {
    total += chunk.byteLength;
    if (total > maxBytes) return "too-large";
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
