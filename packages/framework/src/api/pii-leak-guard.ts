import type { MiddlewareHandler } from "hono";
import { configuredPiiSubjectKms, PII_CIPHERTEXT_PREFIX } from "../crypto";

const isProductionEnv = () => process.env["NODE_ENV"] === "production";
// Version-agnostic: catches both the current PII_CIPHERTEXT_PREFIX and any
// older/decrypt-only format version still present in unmigrated rows.
const CIPHERTEXT_MARKER = "kumiko-pii:v";
const CIPHERTEXT_RE = /kumiko-pii:v\d+:[^"\s<>\\]*/g;

// A PII subject ciphertext never belongs in an API response — its presence
// means a raw DB read (fetchOne/selectMany) leaked to the surface. Dev/test
// fail loud (500) so a forgotten decrypt turns the first integration test
// red; prod redacts + logs instead of shipping the blob. Skipped entirely
// when no subject KMS is configured (no ciphertexts can exist).
export function piiCiphertextResponseGuard(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    // skip: no subject KMS configured — no ciphertexts can exist, nothing to scan
    if (configuredPiiSubjectKms() === undefined) return;
    const contentType = c.res.headers.get("content-type") ?? "";
    // skip: only JSON bodies carry handler data — streams/zips stay untouched
    if (!contentType.includes("application/json")) return;
    const text = await c.res.clone().text();
    // skip: clean response — the common case
    if (!text.includes(CIPHERTEXT_MARKER)) return;

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
    c.res = new Response(text.replace(CIPHERTEXT_RE, "[pii-redacted]"), {
      status: c.res.status,
      headers,
    });
  };
}
