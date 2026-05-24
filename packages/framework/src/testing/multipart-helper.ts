// Workarounds for Bun v1.3.x bun:test limitations with multipart/form-data.
//
// Two bugs combine to break file upload tests in bun:test:
//
// 1. Content-Type omission: both app.request({body: formData}) and
//    fetch(url, {body: formData}) stringify FormData via .toString() instead
//    of serializing it as multipart, so no Content-Type header is set.
//    Fix: serialize FormData manually via buildMultipartBody().
//
// 2. Cross-realm instanceof: Hono's multipart parser creates Blob objects from
//    a different JS realm than the test globals. In bun:test this means
//    `parsedValue instanceof File` is always false even when the value has all
//    File properties. Fix: patchFilInstanceofForBunTest().
//
// Both fixes are test-only — production code and real HTTP clients are unaffected.

/**
 * Serializes a FormData instance to multipart/form-data bytes.
 *
 * Returns the encoded body and the Content-Type header value (including the
 * generated boundary). Pass both directly to app.request or fetch.
 */
export async function buildMultipartBody(
  fd: FormData,
): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `KumikoBnd${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const [name, value] of fd.entries()) {
    if (value instanceof File) {
      parts.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type || "application/octet-stream"}\r\n\r\n`,
        ),
      );
      parts.push(new Uint8Array(await value.arrayBuffer()));
      parts.push(enc.encode("\r\n"));
    } else {
      parts.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`,
        ),
      );
    }
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));

  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return { body: buf, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Patches File[Symbol.hasInstance] so that cross-realm Blob objects returned
 * by Hono's parseBody() pass `instanceof File` checks in bun:test.
 *
 * In bun:test the multipart parser runs in a different JS realm than the test
 * globals, so the Blob/File constructors differ. The patch replaces the
 * prototype-chain check with a duck-type check: an object with string `.name`,
 * number `.size`, and function `.arrayBuffer` is treated as a File.
 *
 * Safe to call multiple times (idempotent via the `_patched` marker).
 */
export function patchFileInstanceofForBunTest(): void {
  if ((File as unknown as { _kumikoPatched?: boolean })._kumikoPatched) return;
  Object.defineProperty(File, Symbol.hasInstance, {
    value(instance: unknown): boolean {
      if (typeof instance !== "object" || instance === null) return false;
      const f = instance as Record<string, unknown>;
      return (
        typeof f["name"] === "string" &&
        typeof f["size"] === "number" &&
        typeof f["arrayBuffer"] === "function"
      );
    },
    configurable: true,
  });
  (File as unknown as { _kumikoPatched?: boolean })._kumikoPatched = true;
}
