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

// Implementation helper — bundled-features uses this to wrap a plaintext after
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

// --- Compile-time response guard (R6) --------------------------------------
//
// ContainsSecret<T> is `true` only when a Secret<> is DEFINITELY present
// somewhere in T. The handler-registration guard (defineWriteHandler/
// defineQueryHandler) turns a `true` into a compile error — the static twin of
// assertNoSecretLeak's runtime walk.
//
// Biased to `false`: anything it cannot inspect — a bare generic type param (a
// handler generic over its response), `unknown`/`any`, `never` — resolves to
// `false` = allowed, with the runtime guard as the backstop. The alternative
// (default-to-leak) false-flags every legitimate generic-over-response handler.
//
// Branch order is load-bearing: never/unknown/any first (uninspectable), then
// Secret, then primitives (covers branded primitives like TenantId without
// enumerating them), then the SafeLeaf allowlist (opaque class instances that
// blind `{ [K in keyof T] }` recursion would mangle — the type-level mirror of
// leak-guard.ts skipping non-plain objects), then arrays, then a "does any
// field contain a secret" fold over plain objects.
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

// Opaque built-in leaves a response legitimately carries; never recurse into
// them. Extend when the bundled-features tsc sweep surfaces a real leaf type.
type SafeLeaf =
  | Date
  | RegExp
  | Temporal.Instant
  | Temporal.ZonedDateTime
  | Temporal.PlainDate
  | Temporal.PlainDateTime
  | Temporal.PlainTime
  | Temporal.PlainYearMonth
  | Temporal.PlainMonthDay
  | Temporal.Duration;

export type ContainsSecret<T> = [T] extends [never]
  ? false
  : unknown extends T
    ? false
    : T extends Secret<unknown>
      ? true
      : T extends Primitive
        ? false
        : T extends SafeLeaf
          ? false
          : T extends readonly (infer U)[]
            ? ContainsSecret<U>
            : T extends object
              ? true extends { [K in keyof T]-?: ContainsSecret<T[K]> }[keyof T]
                ? true
                : false
              : false;

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

// The ctx.secrets contract. Concrete implementation lives in bundled-features
// (createSecretsContext) where the DB and MasterKeyProvider are known. This
// lean interface is what the framework's HandlerContext carries so engine
// code can talk about it without pulling in bundled-features.
export interface SecretsContext {
  get(
    tenantId: TenantId,
    key: SecretKeyRef,
    auditCtx?: SecretAuditContext,
  ): Promise<Secret<string> | undefined>;
  // Metadata-only existence probe: no decryption, no read-audit event.
  // For readiness checks — use get() when the value itself is needed.
  has(tenantId: TenantId, key: SecretKeyRef): Promise<boolean>;
  set(
    tenantId: TenantId,
    key: SecretKeyRef,
    value: string,
    opts?: { redact?: (plaintext: string) => string; hint?: string; updatedBy?: string },
  ): Promise<void>;
  delete(tenantId: TenantId, key: SecretKeyRef, opts?: { deletedBy?: string }): Promise<boolean>;
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
// (@cosmicdrift/kumiko-secrets-vault, @cosmicdrift/kumiko-secrets-aws-kms, ...). The default is
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
