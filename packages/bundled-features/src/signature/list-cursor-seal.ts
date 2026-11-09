import { createHmac } from "node:crypto";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { CompactEncrypt, compactDecrypt } from "jose";

// Domain separation: the same secret also keys the link HMAC.
const CURSOR_KEY_LABEL = "signature-list-cursor";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SealedCursorPayload = { readonly c: string; readonly u: string; readonly t: string };

function isSealedCursorPayload(value: unknown): value is SealedCursorPayload {
  return (
    isPlainObject(value) &&
    typeof value["c"] === "string" &&
    typeof value["u"] === "string" &&
    typeof value["t"] === "string"
  );
}

function cursorKey(secret: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(CURSOR_KEY_LABEL).digest());
}

export async function sealListCursor(
  baseCursor: string,
  user: SessionUser,
  secret: string,
): Promise<string> {
  const payload: SealedCursorPayload = {
    c: baseCursor,
    u: String(user.id),
    t: String(user.tenantId),
  };
  return new CompactEncrypt(encoder.encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(cursorKey(secret));
}

export async function openListCursor(
  sealed: string,
  user: SessionUser,
  secret: string,
): Promise<string | null> {
  try {
    // Allowlist: a foreign header such as PBES2 would cost PBKDF2 rounds per request.
    const { plaintext } = await compactDecrypt(sealed, cursorKey(secret), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const payload: unknown = JSON.parse(decoder.decode(plaintext));
    if (!isSealedCursorPayload(payload)) return null;
    if (payload.u !== String(user.id) || payload.t !== String(user.tenantId)) return null;
    return payload.c;
  } catch {
    return null;
  }
}
