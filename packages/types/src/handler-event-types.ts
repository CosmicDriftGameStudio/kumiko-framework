import type { ZodType } from "zod";
import type { KumikoEventTypeMap } from "./event-type-map.ts";

// --- Event Definitions ---

/**
 * Compile-time mirror of `engine/qualified-name.ts:toKebab` for camelCase
 * → kebab-case. Drives the literal-type of `EventDef.name`, so that
 * `r.defineEvent("foo", schema)` inside `defineFeature("driverOrders")`
 * carries `name: "driver-orders:event:foo"` as a literal — strict-mode
 * for `ctx.events.append({ type: eventDef.name, ... })` lights up.
 *
 * Algorithm mirrors the runtime regex pipeline:
 *   1. `.` → `-` (dot acts as word-boundary)
 *   2. Insert `-` between `[A-Z]+` and `[A-Z][a-z]` (so `SSEFoo` →
 *      `SSE-Foo`, splitting an uppercase run before a camel-hump)
 *   3. Insert `-` between `[a-z0-9]` and `[A-Z]` (camelCase boundary,
 *      so `ticketAssigned` → `ticket-Assigned`)
 *   4. lowercase everything
 *
 * Implemented as a state machine with one-char lookahead. State:
 *   - "start"        — at start of string, or right after a dot-boundary
 *   - "upper"        — last emitted char came from an uppercase letter
 *   - "post-letter"  — last emitted char was a lowercase letter or digit
 *
 * Sync vs runtime is verified by `engine/__tests__/camel-to-kebab.test-d.ts`
 * — the type-tests cross-check identical inputs against `toKebab()`.
 */
export type CamelToKebab<S extends string> = CamelToKebabImpl<S, "start", "">;

type CamelToKebabImpl<
  S extends string,
  Prev extends "start" | "upper" | "post-letter",
  Acc extends string,
> = S extends `${infer C}${infer Rest}`
  ? CharKind<C> extends "upper"
    ? Prev extends "start"
      ? CamelToKebabImpl<Rest, "upper", `${Acc}${Lowercase<C>}`>
      : Prev extends "post-letter"
        ? CamelToKebabImpl<Rest, "upper", `${Acc}-${Lowercase<C>}`>
        : // Prev = "upper" — peek next char to decide between
          // continuing-the-run and splitting-before-camel-hump.
          Rest extends `${infer Next}${string}`
          ? CharKind<Next> extends "lower"
            ? CamelToKebabImpl<Rest, "upper", `${Acc}-${Lowercase<C>}`>
            : CamelToKebabImpl<Rest, "upper", `${Acc}${Lowercase<C>}`>
          : `${Acc}${Lowercase<C>}`
    : CharKind<C> extends "lower"
      ? CamelToKebabImpl<Rest, "post-letter", `${Acc}${C}`>
      : // Non-letter: dots become word-boundaries (state resets to "start"
        // so the next uppercase letter doesn't pick up a redundant dash).
        // Other non-letters (digits etc.) act like lowercase for transitions.
        C extends "."
        ? CamelToKebabImpl<Rest, "start", `${Acc}-`>
        : CamelToKebabImpl<Rest, "post-letter", `${Acc}${C}`>
  : Acc;

/**
 * Three-way classification used by `CamelToKebab`:
 *   - "lower"      — a lowercase letter (a-z and Unicode lowercase)
 *   - "upper"      — an uppercase letter (A-Z and Unicode uppercase)
 *   - "non-letter" — digit, dot, dash, etc. (Lowercase==Uppercase for them)
 */
type CharKind<C extends string> =
  C extends Lowercase<C> ? (C extends Uppercase<C> ? "non-letter" : "lower") : "upper";

/**
 * Builds the qualified event-name from feature + inner-name in the same
 * shape the runtime emits via `qn(toKebab(feature), "event", toKebab(inner))`.
 */
export type QualifiedEventName<
  TFeature extends string,
  TInner extends string,
> = `${CamelToKebab<TFeature>}:event:${CamelToKebab<TInner>}`;

// PII payload fields on a custom event: `field` is encrypted under
// the DEK the subject spec names (crypto-shredding).
//
// `{ personal: { of: "<ownerField>" } }` is the canonical user-subject form,
// matching the entity-field `personal` vocabulary (see fields.ts).
// `personal: "tenant"` and `personal: "self"` declare the event's tenant
// (envelope.tenantId) or its own aggregate stream (envelope.aggregateType +
// aggregateId) as the subject instead — resolved via `resolveEventSubject`
// in `packages/framework/src/crypto/subject-resolver.ts`.
//
// `whenAbsent` decides what happens when the named owner field carries no
// id (system- or cron-triggered writes): "tenant" re-targets the envelope
// tenant key, "self" the event's own aggregate stream (record key),
// "plaintext" is an explicit acknowledgement that the value ships
// unencrypted and cannot be crypto-shredded. Undeclared is not another
// option — the append fails closed instead of leaking.
export type EventPiiAbsentSubject = "plaintext" | "tenant" | "self";

export type EventPiiSubject =
  | {
      readonly personal: {
        readonly of: string;
        readonly whenAbsent?: EventPiiAbsentSubject;
      };
    }
  | { readonly personal: "tenant" }
  | { readonly personal: "self" };

export type EventPiiFields = Readonly<Record<string, EventPiiSubject>>;

export type NormalizedEventPiiSubject =
  | {
      readonly kind: "user";
      readonly ownerField: string;
      readonly whenAbsent: EventPiiAbsentSubject | undefined;
    }
  | { readonly kind: "tenant" }
  | { readonly kind: "self" };

export function normalizeEventPiiSubject(spec: EventPiiSubject): NormalizedEventPiiSubject {
  if (spec.personal === "tenant") return { kind: "tenant" };
  if (spec.personal === "self") return { kind: "self" };
  return { kind: "user", ownerField: spec.personal.of, whenAbsent: spec.personal.whenAbsent };
}

// The full set of PII stances a defineEvent() call may declare. "none" is a
// distinct value from `{}` — an empty object is indistinguishable from "the
// author forgot to list fields", while "none" is an explicit assertion that
// the payload carries no personal data.
export type EventPiiStance = EventPiiFields | "none";

export type EventDef<TPayload = unknown, TName extends string = string> = {
  readonly name: TName;
  readonly schema: ZodType<TPayload>;
  // Schema generation number. Starts at 1; bumped whenever a breaking change
  // to the payload shape lands together with a matching r.eventMigration that
  // upcasts older stored events. Reads consult this to decide if upcasters
  // need to run before the payload hits consumer code.
  readonly version: number;
  readonly piiFields: EventPiiStance;
};

// Every append states what it expects of the stream. expectedVersion pins the version the caller's
// decision was based on (0 for a stream it just created); a concurrent append then fails with
// version_conflict instead of landing on top. blindAppendReason says why the event is valid
// whatever was appended meanwhile; the stream version is then read at append time.
export type AppendConcurrency =
  | { readonly expectedVersion: number; readonly blindAppendReason?: never }
  | { readonly blindAppendReason: string; readonly expectedVersion?: never };

// Args for ctx.events.append — explicit aggregate target, Marten-style.
// `type` must match a name returned by r.defineEvent in any registered
// feature; payload is validated against that event's Zod schema before
// being written to the events-table.
//
// `headers` lands in StoredEvent.metadata.headers — Marten-conform free
// key/value space for app-specific metadata (A/B-bucket, geo-region,
// client SDK version). Framework does not interpret values; keep them
// JSON-primitive (string|number|boolean) for safe serialization.
export type AppendEventArgs = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly payload: unknown;
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
} & AppendConcurrency;

// Typed-payload variant — used by the strict ctx.events.append. Keyed via
// the discriminator type-arg so payload inference flows from `type`-literal
// to the matching schema-payload.
//
// TMap is propagated as a generic parameter (not hard-coded to
// KumikoEventTypeMap) so the constraint `K extends keyof TMap` resolves at
// USE-site instead of definition-site. Cross-package augmentation only
// becomes visible at use-site — the App's tsc compiles the augmentation
// alongside its own code, so `keyof TMap` widens to include all augmented
// event names. Hard-coding `keyof KumikoEventTypeMap` here would resolve
// at definition-site (framework's compile) where the augmentation is
// invisible → K = never, no strict-checking. The default = KumikoEventTypeMap
// keeps existing call-sites zero-config.
export type TypedAppendEventArgs<TMap extends object, K extends keyof TMap> = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: K;
  readonly payload: TMap[K];
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
} & AppendConcurrency;

// Strict-only form. Single overload — `<K extends keyof TMap>` against the
// app's pre-bound TMap. No fallback overload: apps that need runtime-pluggable
// events (where the type-string isn't known at compile-time) reach for
// `unsafeAppendEvent`.
//
// Why no fallback overload:
//   A two-overload form (`(args: AppendEventArgs)` as the second sig)
//   silently accepts any args via the loose overload as soon as TS can't
//   prove the strict one matches. Cross-package, the strict overload's
//   `K = keyof TMap` collapses to `never` when called WITHOUT a local
//   wrapper (default-substitution is eager at definition-site → augmentation
//   invisible). Either every caller binds TMap via wrapper → strict fires;
//   or they don't, and the fallback would silently swallow every typo.
//   We pick the first option and force the wrong path to fail visibly.
//
// How this is wired in practice:
//   - Apps that augment KumikoEventTypeMap get a strict ctx.events.append in
//     handlers bound to that map. Without an augmentation, emit through
//     `emitEvent(ctx, eventDef, ...)`, which checks the payload against the
//     EventDef returned by r.defineEvent.
//   - Cross-package callers (e.g. bundled-features's set.write.ts) that
//     can't afford a local wrapper reach for `ctx.events.unsafeAppend`
//     instead — the untyped variant for runtime-pluggable events, with the
//     same checks (schema, archive, version expectation). For typed payloads
//     use emitEvent(ctx, eventDef, ...).
export type AppendEventFn<TMap extends object = KumikoEventTypeMap> = <K extends keyof TMap>(
  args: TypedAppendEventArgs<TMap, K>,
) => Promise<void>;

export type UnsafeAppendEventFn = (args: AppendEventArgs) => Promise<void>;

// Savepoint-scoped append — returns a discriminated result instead of
// throwing on VersionConflictError, so a handler can react gracefully to
// losing a race against a concurrent writer on the same aggregate stream
// (e.g. two idempotent ingest calls for the same dedup key). The append
// runs inside a driver-native SAVEPOINT: a conflict rolls back only that
// nested scope, leaving the rest of the handler's transaction usable —
// unlike unsafeAppendEvent, whose thrown VersionConflictError poisons the
// entire enclosing transaction.
export type TryAppendEventResult =
  | { readonly ok: true; readonly event: import("./event-store-types.ts").StoredEvent }
  | { readonly ok: false; readonly conflict: import("./event-store-types.ts").VersionConflict };

export type TryAppendEventFn = (args: AppendEventArgs) => Promise<TryAppendEventResult>;

// Args for ctx.events.fetchForWriting — Marten FetchForWriting equivalent. Returns
// the current stream state + a handle that appends without re-specifying
// aggregateId/aggregateType. When expectedVersion is provided, the handle
// rejects the write immediately if the stream is ahead — optimistic
// concurrency enforced BEFORE any downstream work. Without expectedVersion,
// the handle trusts whatever version the stream currently has.
export type FetchForWritingArgs = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly expectedVersion?: number;
};

export type AggregateStreamHandle = {
  // Snapshot at fetch time — upcasted via the registered upcaster chain,
  // so payloads match the current schema regardless of when they landed.
  readonly events: readonly import("./event-store-types.ts").StoredEvent[];
  readonly version: number;
  // Append an event on this stream. Derives aggregateId/aggregateType/
  // expectedVersion from the handle automatically. Multiple calls in a
  // row bump the handle's internal version and the events-table in order.
  // Only this handle's own appendOne calls advance the pinned version: if the
  // same handler also writes to this aggregateId another way (ctx.events.append,
  // a second handle, a CRUD write or a nested ctx.dispatch.write), the next appendOne
  // fails with VersionConflictError against that handler's own write. Route
  // every append for the aggregate through one handle.
  readonly appendOne: (args: { readonly type: string; readonly payload: unknown }) => Promise<void>;
  // Idempotency check against `events` (fetch-time snapshot only — an
  // appendOne in the same handler isn't reflected). Guards a handler that
  // may run twice against the same stream without risking a false
  // "already succeeded" read that appendIfAbsent-style helpers would give
  // on a genuine optimistic-concurrency conflict.
  readonly hasEvent: (type: string) => boolean;
};

// --- Event Upcasters (schema migration) ---
//
// Marten's Upcaster pattern adapted for TypeScript. An event's payload shape
// may evolve over releases; stored events stay immutable on disk. Features
// register step-wise transforms that upgrade v(N) payloads to v(N+1) at read
// time. The framework chains them automatically — a v1 event gets walked
// through every registered migration up to the current version before the
// payload reaches a projection apply() or ctx.events.append consumer.
//
// Sync transforms: just return the upgraded payload. Most schema-evolution
// (renames, additions, format-fixes) needs no IO and stays sync — fast on
// the hot path of projection-rebuild.
//
// Async transforms (Marten's "AsyncOnlyEventUpcaster"): when the upgrade
// needs DB enrichment (e.g. v1 stored only a customerId, v2 also needs the
// customer's segment which lives in a reference table), accept the optional
// ctx-arg, run the lookup via ctx.db, return a Promise. The framework
// awaits unconditionally — sync transforms return a plain value and pay
// only the await-microtask overhead. Pattern-match Marten:
//   r.defineEvent("invoiceCreated", schema, {
//     version: 2,
//     migrations: [{ fromVersion: 1, toVersion: 2, transform: async (payload, ctx) => {
//       const customer = await ctx.db.select().from(customersTable)...;
//       return { ...payload, customerSegment: customer.segment };
//     } }],
//   });
export type EventUpcastCtx = {
  readonly db: import("./db-connection.ts").DbRunner;
  readonly tenantId: import("./identifiers.ts").TenantId;
};

export type EventUpcastFn = (payload: unknown, ctx: EventUpcastCtx) => unknown | Promise<unknown>;

// Declarative single-step migration — common payload transforms without an
// imperative function. Applied in fixed order: rename → default → map.
export type DeclarativeEventMigration = {
  // old key → new key; a missing source key is a no-op
  readonly rename?: Readonly<Record<string, string>>;
  // set only when the key is absent — never overwrites an existing value
  readonly default?: Readonly<Record<string, unknown>>;
  // per-key value transform; skipped when the key is absent
  readonly map?: Readonly<Record<string, (value: unknown) => unknown>>;
};

export type EventMigrationDef = {
  // Qualified event name, matching r.defineEvent(...).name.
  readonly eventName: string;
  readonly fromVersion: number;
  readonly toVersion: number; // must be fromVersion + 1
  readonly transform: EventUpcastFn;
};
