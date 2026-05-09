import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
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

    async writeStream(key, source, _options): Promise<void> {
      // Atomar via tmp-File + rename: ein Reader der den finalen Pfad
      // sieht, sieht entweder die alte Version (falls vorhanden) oder
      // die vollstaendige neue. Niemals einen halb-fertigen Stream.
      // Falls der Stream mid-write bricht, ist das tmp-Cleanup
      // best-effort — je nach OS-Race im stream-destroy-Pfad kann
      // das `.tmp`-File kurz liegen bleiben. Kein Korrektheits-
      // Problem (kein Reader sucht `*.tmp`-Patterns), nur Operations-
      // Hygiene; ein periodischer cron-cleanup auf alten `.tmp`-Files
      // ist die saubere Loesung wenn das in Production realistisch
      // greift.
      const filePath = join(basePath, key);
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(dirname(filePath), { recursive: true });
      try {
        await pipeline(source, createWriteStream(tmpPath));
        await rename(tmpPath, filePath);
      } catch (e) {
        // Best-effort tmp-Cleanup; wenn das auch failt, hat der
        // Filesystem ein Problem das nicht in unserem Scope liegt.
        await unlink(tmpPath).catch(() => {});
        throw e;
      }
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
