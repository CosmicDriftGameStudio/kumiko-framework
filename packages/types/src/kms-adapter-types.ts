import type { TenantId } from "./identifiers";

// The subject a DEK belongs to. User data is shredded on user-forget,
// tenant data on tenant-destroy, record data on a row-scoped forget —
// three erase triggers, three subject kinds.
export type SubjectId =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "tenant"; readonly tenantId: TenantId }
  | { readonly kind: "record"; readonly entity: string; readonly id: string };

// Compact storage key ("user:<uuid>" / "tenant:<uuid>" / "record:<entity>:<id>")
// — primary key in adapter backends and cache key in the request-level DEK cache.
export type SubjectKey = string;

export function subjectKeyForUser(userId: string): SubjectKey {
  return `user:${userId}`;
}

export function subjectKeyForTenant(tenantId: TenantId): SubjectKey {
  return `tenant:${tenantId}`;
}

export function subjectKeyForRecord(entity: string, id: string): SubjectKey {
  // The key is parsed back on exactly one ":" — an entity containing ":" would break the round-trip.
  if (entity === "" || entity.includes(":"))
    throw new Error(`Invalid record entity for subject key: ${entity}`);
  if (id === "") throw new Error("Invalid record id for subject key: empty");
  return `record:${entity}:${id}`;
}

export function subjectIdToKey(subject: SubjectId): SubjectKey {
  switch (subject.kind) {
    case "user":
      return subjectKeyForUser(subject.userId);
    case "tenant":
      return subjectKeyForTenant(subject.tenantId);
    case "record":
      return subjectKeyForRecord(subject.entity, subject.id);
  }
}

export function subjectIdFromKey(key: SubjectKey): SubjectId {
  if (key.startsWith("user:")) return { kind: "user", userId: key.slice("user:".length) };
  if (key.startsWith("tenant:")) {
    return { kind: "tenant", tenantId: key.slice("tenant:".length) as TenantId }; // @cast-boundary parse of a key this module minted
  }
  if (key.startsWith("record:")) {
    const rest = key.slice("record:".length);
    const separatorIndex = rest.indexOf(":");
    const entity = separatorIndex === -1 ? "" : rest.slice(0, separatorIndex);
    const id = separatorIndex === -1 ? "" : rest.slice(separatorIndex + 1);
    if (entity === "" || id === "") throw new Error(`Invalid subject key: ${key}`);
    return { kind: "record", entity, id };
  }
  throw new Error(`Invalid subject key: ${key}`);
}

export interface KmsContext {
  readonly tenantId?: TenantId;
  readonly requestId: string;
  readonly userId?: string;
  readonly eraseReason?: string;
}

export interface KmsHealth {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly details?: Record<string, unknown>;
}

// 32-byte AES-256 data-encryption key, unwrapped and ready for local use.
export type SubjectDek = Buffer;

interface KmsAdapterBase {
  /**
   * Creates a fresh subject key. Throws KeyAlreadyExistsError when the
   * subject already has one — including an erased tombstone: a shredded
   * subject must never get a new key, or forget could be undone by
   * re-encrypting under it.
   */
  createKey(subject: SubjectId, ctx: KmsContext): Promise<void>;

  /**
   * Erases the key material immediately; the tombstone row stays for the
   * audit trail. Idempotent — repeat calls and unknown subjects are no-ops.
   */
  eraseKey(subject: SubjectId, ctx: KmsContext): Promise<void>;

  /** Probe for boot + readiness. Throws when the backend is unreachable. */
  health(): Promise<KmsHealth>;
}

// Backends that hand out the plaintext DEK (Pg, InMemory). Encrypt/decrypt
// happens locally; DEKs are cacheable per request.
export interface LocalKeyKmsAdapter extends KmsAdapterBase {
  readonly capabilities: { readonly mode: "local-key" };

  /**
   * Throws KeyErasedError after eraseKey (callers render "[[erased]]"),
   * KeyNotFoundError when the subject never had a key (typically a bug).
   */
  getKey(subject: SubjectId, ctx: KmsContext): Promise<SubjectDek>;
}

// Backends that never release key material (Vault transit, cloud KMS).
// Every encrypt/decrypt is a round-trip; nothing is cacheable.
export interface RemoteCryptoKmsAdapter extends KmsAdapterBase {
  readonly capabilities: { readonly mode: "remote-crypto" };

  encrypt(subject: SubjectId, plaintext: Uint8Array, ctx: KmsContext): Promise<Uint8Array>;

  /** Same error contract as LocalKeyKmsAdapter.getKey. */
  decrypt(subject: SubjectId, ciphertext: Uint8Array, ctx: KmsContext): Promise<Uint8Array>;
}

export type KmsAdapter = LocalKeyKmsAdapter | RemoteCryptoKmsAdapter;

export function isLocalKeyKmsAdapter(adapter: KmsAdapter): adapter is LocalKeyKmsAdapter {
  return adapter.capabilities.mode === "local-key";
}
