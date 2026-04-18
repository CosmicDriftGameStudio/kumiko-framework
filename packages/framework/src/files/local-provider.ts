import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileStorageProvider } from "./types";

// Local-filesystem backend — intended for dev + tests. Production deploys
// pick an object-store provider (S3/R2/…). mimeType is ignored here; the
// filesystem tracks no metadata beyond what the caller stores on FileRef.
export function createLocalProvider(basePath: string): FileStorageProvider {
  return {
    async write(key: string, data: Uint8Array, _mimeType?: string): Promise<void> {
      const filePath = join(basePath, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    },

    async read(key: string): Promise<Uint8Array> {
      const filePath = join(basePath, key);
      return readFile(filePath);
    },

    async delete(key: string): Promise<void> {
      const filePath = join(basePath, key);
      await rm(filePath, { force: true });
    },

    async exists(key: string): Promise<boolean> {
      try {
        await stat(join(basePath, key));
        return true;
      } catch {
        return false;
      }
    },
  };
}
