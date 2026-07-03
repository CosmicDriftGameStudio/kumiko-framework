import type { TenantId } from "../engine/types/identifiers";

// The subject a DEK belongs to. User data is shredded on user-forget,
// tenant data on tenant-destroy — two erase triggers, two subject kinds.
export type SubjectId =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "tenant"; readonly tenantId: TenantId };

// Compact storage key ("user:<uuid>" / "tenant:<uuid>") — primary key in
// adapter backends and cache key in the request-level DEK cache.
export type SubjectKey = string;

export function subjectKeyForUser(userId: string): SubjectKey {
  return `user:${userId}`;
}

export function subjectKeyForTenant(tenantId: TenantId): SubjectKey {
  return `tenant:${tenantId}`;
}

export function subjectIdToKey(subject: SubjectId): SubjectKey {
  return subject.kind === "user"
    ? subjectKeyForUser(subject.userId)
    : subjectKeyForTenant(subject.tenantId);
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

export class KeyErasedError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key erased: ${subjectIdToKey(subject)}`);
    this.name = "KeyErasedError";
  }
}

export class KeyNotFoundError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key not found: ${subjectIdToKey(subject)}`);
    this.name = "KeyNotFoundError";
  }
}

export class KeyAlreadyExistsError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key already exists: ${subjectIdToKey(subject)}`);
    this.name = "KeyAlreadyExistsError";
  }
}
