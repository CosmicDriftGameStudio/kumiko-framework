// Canonical at-rest form of an Envelope: every Buffer as base64, ready for
// jsonb columns (secrets feature) or JSON-stringified TEXT columns
// (EnvelopeCipher for config values / entity fields). One wire shape for
// every envelope-encrypted store in the framework.

import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { Envelope } from "./types.ts";

export type StoredEnvelope = {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly authTag: string; // base64
  readonly encryptedDek: string; // base64
  readonly kekVersion: number;
};

export function encodeStoredEnvelope(envelope: Envelope): StoredEnvelope {
  return {
    ciphertext: envelope.ciphertext.toString("base64"),
    iv: envelope.iv.toString("base64"),
    authTag: envelope.authTag.toString("base64"),
    encryptedDek: envelope.encryptedDek.toString("base64"),
    kekVersion: envelope.kekVersion,
  };
}

export function decodeStoredEnvelope(stored: StoredEnvelope): Envelope {
  return {
    ciphertext: Buffer.from(stored.ciphertext, "base64"),
    iv: Buffer.from(stored.iv, "base64"),
    authTag: Buffer.from(stored.authTag, "base64"),
    encryptedDek: Buffer.from(stored.encryptedDek, "base64"),
    kekVersion: stored.kekVersion,
  };
}

export function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (!isPlainObject(value)) return false;
  return (
    typeof value["ciphertext"] === "string" &&
    typeof value["iv"] === "string" &&
    typeof value["authTag"] === "string" &&
    typeof value["encryptedDek"] === "string" &&
    typeof value["kekVersion"] === "number"
  );
}
