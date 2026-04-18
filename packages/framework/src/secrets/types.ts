// Envelope Encryption types. Separating DEK (per-value) from KEK (central)
// is what makes key rotation cheap: on rotation we only re-wrap the small
// encryptedDek, never touch the ciphertext.

import type { TenantId } from "../engine";

// Plaintext-secret wrapper (branded). Carries the actual string internally
// but the nominal typing stops it from landing in an HTTP response by
// accident — a response-serializer guard + the reveal() cost make the leak
// intentional. Framework code that sees `Secret<string>` knows the caller
// has already gone through the audited ctx.secrets.get path.
//
// The brand is a real (non-registered) Symbol so it exists at runtime for
// isSecret() without clashing with user-land symbols of the same name.
const SecretBrand: unique symbol = Symbol("kumiko.secret");

export type Secret<T = string> = {
  readonly [SecretBrand]: true;
  readonly reveal: () => T;
};

// Implementation helper — core-features uses this to wrap a plaintext after
// decryption. Kept in the framework so both sides share one canonical brand.
export function createSecret<T>(value: T): Secret<T> {
  return {
    [SecretBrand]: true as const,
    reveal: () => value,
  };
}

// True for any object carrying the Secret brand. Used by the response guard
// to reject leaks before serialization.
export function isSecret(v: unknown): v is Secret<unknown> {
  return typeof v === "object" && v !== null && SecretBrand in v;
}

// Per-read audit context. Populated by requireSecretsContext() wrapper so
// handlers don't need to pass userId/handlerName manually on every call.
// Undefined for framework-internal reads (rotation job, tests) — the audit
// table stays a "who touched this credential" log, not a crash-report sink.
export type SecretAuditContext = {
  readonly userId: string;
  readonly handlerName: string;
};

// Feature code can pass either the raw qualified-name string or a typed
// handle returned by r.secret. The handle form is safer — renaming the
// r.secret call updates all references through the import graph.
export type SecretKeyRef = string | { readonly name: string };

// The ctx.secrets contract. Concrete implementation lives in core-features
// (createSecretsContext) where the DB and MasterKeyProvider are known. This
// lean interface is what the framework's HandlerContext carries so engine
// code can talk about it without pulling in core-features.
export interface SecretsContext {
  get(
    tenantId: TenantId,
    key: SecretKeyRef,
    auditCtx?: SecretAuditContext,
  ): Promise<Secret<string> | undefined>;
  set(
    tenantId: TenantId,
    key: SecretKeyRef,
    value: string,
    opts?: { redact?: (plaintext: string) => string; hint?: string; updatedBy?: string },
  ): Promise<void>;
  delete(tenantId: TenantId, key: SecretKeyRef): Promise<boolean>;
}

export type Envelope = {
  // AES-256-GCM ciphertext of the plaintext, keyed with a DEK.
  readonly ciphertext: Buffer;
  // GCM nonce (12 bytes). Generated fresh per encryption.
  readonly iv: Buffer;
  // GCM auth tag (16 bytes). Guarantees the ciphertext wasn't tampered.
  readonly authTag: Buffer;
  // DEK wrapped with the current KEK. Decryption needs provider.unwrapDek
  // with the kekVersion to recover the DEK.
  readonly encryptedDek: Buffer;
  // Which KEK version was used to wrap the DEK. On rotation, rows with old
  // versions still decrypt — the provider keeps a keyring of historical KEKs.
  readonly kekVersion: number;
};

// The contract a KEK backend must fulfil. The framework sees only this
// interface; concrete implementations live in separate packages
// (@kumiko/secrets-vault, @kumiko/secrets-aws-kms, ...). The default is
// EnvMasterKeyProvider which reads keys from environment variables.
export interface MasterKeyProvider {
  // Wrap a fresh DEK with the current KEK. Returns the wrapped bytes + the
  // KEK version used — the version ends up in the Envelope so decryption
  // later knows which KEK to ask for.
  wrapDek(dek: Buffer): Promise<{ encryptedDek: Buffer; kekVersion: number }>;

  // Unwrap a previously-wrapped DEK. During rotation the provider must
  // accept older kekVersion values (2-version window minimum), otherwise
  // old rows become unreadable.
  unwrapDek(encryptedDek: Buffer, kekVersion: number): Promise<Buffer>;

  // Which KEK version new wraps use. Rotation flips this to a new value
  // and older-version reads continue to work until rows are re-wrapped.
  currentVersion(): number;

  // Health check: can the provider talk to its backend? Used by
  // /health/ready. Cheap probe, no KEK material read.
  isAvailable(): Promise<boolean>;
}
