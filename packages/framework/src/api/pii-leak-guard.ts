import type { MiddlewareHandler } from "hono";
import { PII_CIPHERTEXT_PREFIX } from "../crypto/index.js";

const isProductionEnv = () => process.env["NODE_ENV"] === "production";
// Version-agnostic: catches both the current PII_CIPHERTEXT_PREFIX and any
// older/decrypt-only format version still present in unmigrated rows.
// Bound to the full ciphertext shape (prefix, "<kind>:<id>" subject key, base64
// blob of at least IV + GCM tag = 28 bytes) so a user-typed "kumiko-pii:v" in a
// note or name field cannot turn every read of that record into a 500.
const CIPHERTEXT_RE = /kumiko-pii:v\d+:[^:"\s<>\\]+:[^:"\s<>\\]+:[A-Za-z0-9+/=]{40,}/;
const CIPHERTEXT_REDACT_RE = new RegExp(CIPHERTEXT_RE.source, "g");

// A PII subject ciphertext never belongs in an API response — its presence
// means a raw DB read (fetchOne/selectMany) leaked to the surface. Dev/test
// fail loud (500) so a forgotten decrypt turns the first integration test
// red; prod redacts + logs instead of shipping the blob. Scans unconditionally:
// legacy ciphertext rows can outlive a subject KMS that later became
// unconfigured, and the marker check itself needs no KMS access to run.
export function piiCiphertextResponseGuard(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const contentType = c.res.headers.get("content-type") ?? "";
    // skip: only JSON bodies carry handler data — streams/zips stay untouched
    if (!contentType.includes("application/json")) return;
    const text = await c.res.clone().text();
    // skip: clean response — the common case
    if (!CIPHERTEXT_RE.test(text)) return;

    const detail =
      `[api] JSON response for ${c.req.method} ${c.req.path} contains a PII ciphertext ` +
      `("${PII_CIPHERTEXT_PREFIX}…") — a raw DB read leaked to the API surface. ` +
      `Decrypt before returning (decryptStoredPii / executor read path).`;
    if (!isProductionEnv()) {
      c.res = Response.json(
        { error: { code: "pii_ciphertext_leak", httpStatus: 500, message: detail } },
        { status: 500 },
      );
      // skip: response replaced with the loud 500 above — nothing left to do
      return;
    }
    console.error(detail);
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(text.replace(CIPHERTEXT_REDACT_RE, "[pii-redacted]"), {
      status: c.res.status,
      headers,
    });
  };
}
