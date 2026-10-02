import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { assertSafeStorageKey, type FileStorageProvider } from "./types.js";

// Local-filesystem backend — intended for dev + tests. Production deploys
// pick an object-store provider (S3/R2/…). mimeType is ignored here; the
// filesystem tracks no metadata beyond what the caller stores on FileRef.
export function createLocalProvider(basePath: string): FileStorageProvider {
  const resolvedBase = resolve(basePath);

  // Callers are expected to only ever pass keys built by buildStorageKey(),
  // but the storage layer shouldn't rely solely on that — this resolves the
  // real path and rejects anything that escapes basePath (e.g. a `..`
  // segment that slipped past an upstream check), regardless of the key's
  // source.
  function resolveContainedPath(key: string): string {
    assertSafeStorageKey(key);
    // assertSafeStorageKey rejects every literal "."/".." segment, which
    // covers all string-based traversal a join+resolve can produce; this
    // startsWith check is a second, independent line of defense in case a
    // future caller feeds resolveContainedPath something pre-resolved.
    const filePath = resolve(join(basePath, key));
    if (filePath !== resolvedBase && !filePath.startsWith(resolvedBase + sep)) {
      throw new Error(`storage key escapes basePath: "${key}"`);
    }
    return filePath;
  }
  return {
    async write(key: string, data: Uint8Array, _mimeType?: string): Promise<void> {
      const filePath = resolveContainedPath(key);
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
      const filePath = resolveContainedPath(key);
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
      const filePath = resolveContainedPath(key);
      return readFile(filePath);
    },

    readStream(key: string): AsyncIterable<Uint8Array> {
      // node:fs createReadStream ist ein AsyncIterable<Buffer>; Buffer
      // extends Uint8Array. Wir bauen einen kleinen Adapter weil
      // @types/node das asyncIterator als AsyncIterableIterator<any>
      // typt — Adapter sichert die Surface auf Uint8Array.
      // Default-highWaterMark = 64KB Chunks, was fuer ZIP-Stream-Konsum
      // gut ist. Errors landen im for-await-Loop des Konsumenten
      // (z.B. ENOENT bei Missing-File faellt erst beim ersten chunk-
      // pull, nicht beim readStream-Aufruf — gleiches Lazy-Verhalten
      // wie inmemory + S3).
      const filePath = resolveContainedPath(key);
      const stream = createReadStream(filePath);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of stream) {
            // Stream ohne encoding liefert Buffer. Buffer extends Uint8Array,
            // aber @types/node typt asyncIterator als string|Buffer. View
            // ohne copy auf dasselbe ArrayBuffer; runtime-check schliesst
            // den string-Branch aus (Stream wurde nicht mit encoding= gesetzt).
            if (typeof chunk === "string") {
              throw new Error(
                "local-provider readStream: unexpected string chunk (encoding leaked)",
              );
            }
            yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          }
        },
      };
    },

    async delete(key: string): Promise<void> {
      const filePath = resolveContainedPath(key);
      await rm(filePath, { force: true });
    },

    async exists(key: string): Promise<boolean> {
      try {
        await stat(resolveContainedPath(key));
        return true;
      } catch {
        return false;
      }
    },

    async list(prefix: string): Promise<readonly string[]> {
      // Walk only the directory part of the prefix: a tenant-scoped sweep must
      // not traverse every other tenant's files in a shared storage root.
      // Keys are normalized to "/" (storage keys are always "/"-joined,
      // matching S3) before the final prefix match.
      const prefixDir = prefix.slice(0, prefix.lastIndexOf("/") + 1);
      const walkRoot = prefixDir === "" ? resolvedBase : resolveContainedPath(prefixDir);
      let entries: Dirent[];
      try {
        entries = await readdir(walkRoot, { recursive: true, withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return [];
        throw err;
      }
      const results: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const key = relative(resolvedBase, join(entry.parentPath, entry.name)).split(sep).join("/");
        if (key.startsWith(prefix)) results.push(key);
      }
      return results;
    },
  };
}
