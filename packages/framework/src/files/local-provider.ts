import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileMetadata, FileStorageProvider } from "./types";

export function createLocalProvider(basePath: string): FileStorageProvider {
  return {
    async upload(key: string, data: Uint8Array, _metadata: FileMetadata): Promise<void> {
      const filePath = join(basePath, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    },

    async download(key: string): Promise<Uint8Array> {
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
