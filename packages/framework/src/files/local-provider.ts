import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import { assertSafeStorageKey, type FileStorageProvider } from "./types.ts";

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
      // Atomic via a temporary file and rename: readers see either the previous version (if any) or
      // the complete new version, never a partially written stream. If the stream fails during
      // writing, temporary-file cleanup is best-effort; an OS race in stream destruction can leave
      // the `.tmp` file briefly. This affects operational hygiene only, because readers never
      // search `*.tmp` patterns. A periodic cleanup of old `.tmp` files is appropriate if this runs
      // in production.
      const filePath = resolveContainedPath(key);
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(dirname(filePath), { recursive: true });
      try {
        await pipeline(source, createWriteStream(tmpPath));
        await rename(tmpPath, filePath);
      } catch (e) {
        // Best-effort temporary-file cleanup; if that also fails, the filesystem problem is outside
        // this component's scope.
        await unlink(tmpPath).catch(() => {});
        throw e;
      }
    },

    async read(key: string): Promise<Uint8Array> {
      const filePath = resolveContainedPath(key);
      return readFile(filePath);
    },

    readStream(key: string): AsyncIterable<Uint8Array> {
      // node:fs createReadStream is an AsyncIterable<Buffer>; Buffer extends Uint8Array. This
      // adapter preserves a Uint8Array surface because @types/node types the async iterator as
      // AsyncIterableIterator<any>. The default highWaterMark produces 64KB chunks, which suits ZIP
      // stream consumption. Errors reach the consumer's for-await loop; for example, a missing file
      // raises ENOENT on the first chunk pull rather than when readStream is called, matching the
      // lazy behavior of in-memory and S3 providers.
      const filePath = resolveContainedPath(key);
      const stream = createReadStream(filePath);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of stream) {
            // A stream without an encoding yields Buffer. Buffer extends Uint8Array, but
            // @types/node types the async iterator as string|Buffer. Take a zero-copy view
            // onto the same ArrayBuffer; the runtime check rules out the string branch
            // because the stream was not opened with an encoding.
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
        const code = errorCodeOf(err);
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
