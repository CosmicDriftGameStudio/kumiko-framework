import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { TenantId } from "../../engine";
import { defineQueryHandler } from "../../engine/define-handler";
import { type ContainsSecret, createSecret, type Secret } from "../index";

// R6 is a COMPILE-TIME guard. The type-level assertions below are the real
// coverage — they are checked by tsc (the bun runtime strips types without
// checking). The runtime test only proves the guarded registration functions
// still build a clean handler.

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// One exported tuple so each case is checked by tsc without tripping
// noUnusedLocals on a named alias. Any wrong predicate fails to compile here.
export type _R6TypeAssertions = [
  // Clean responses → false, incl. branded primitives (TenantId, via Primitive)
  // and opaque leaves (Temporal.Instant, Date, via SafeLeaf). These double as
  // the false-positive guard: a mangled leaf would flip the case to `true`.
  Expect<Equal<ContainsSecret<{ ok: true; id: string }>, false>>,
  Expect<Equal<ContainsSecret<{ id: TenantId; when: Temporal.Instant; at: Date }>, false>>,
  Expect<Equal<ContainsSecret<{ items: { label: string }[]; total: number }>, false>>,
  Expect<Equal<ContainsSecret<{ apiKey: string }>, false>>, // revealed → plain string
  // A Secret<> anywhere → true.
  Expect<Equal<ContainsSecret<{ apiKey: Secret<string> }>, true>>,
  Expect<Equal<ContainsSecret<{ creds: { token: Secret<string> } }>, true>>,
  Expect<Equal<ContainsSecret<{ keys: Secret<string>[] }>, true>>,
  Expect<Equal<ContainsSecret<{ when: Temporal.Instant; secret: Secret<string> }>, true>>,
  // Uninspectable types are biased to `false` (allowed) — the runtime guard is
  // the backstop. This is what keeps generic-over-response handlers compiling.
  Expect<Equal<ContainsSecret<unknown>, false>>,
  Expect<Equal<ContainsSecret<never>, false>>,
  // 556/3: ContainsSecret<A | B> distributes over the union (naked type
  // param) to `ContainsSecret<A> | ContainsSecret<B>` = `boolean`, not the
  // literal `true` — pinned here so a future change to this predicate can't
  // silently regress it. The actual leak-guard in define-handler.ts compares
  // via `true extends ContainsSecret<TData>` (556/1) instead of `ContainsSecret<
  // TData> extends true`, which is fail-closed for `boolean` either way.
  Expect<Equal<ContainsSecret<{ ok: true } | { s: Secret<string> }>, boolean>>,
  // 556/2: Map/Set are explicit SafeLeaf members now — pins that the runtime
  // guard's "walk Map/Set entries separately" intent is mirrored, not an
  // accidental compile-time blind spot.
  Expect<Equal<ContainsSecret<Map<string, Secret<string>>>, false>>,
  Expect<Equal<ContainsSecret<Set<Secret<string>>>, false>>,
];

const schema = z.object({ q: z.string() });
declare const aSecret: Secret<string>;

// End-to-end: a Secret<> in the query response is a compile error at the call.
// @ts-expect-error — R6: Secret<> must not appear in a handler response
defineQueryHandler({
  name: "t:query:leak",
  schema,
  handler: async () => ({ apiKey: aSecret }),
});

// Regression: a handler generic over its response (the createTokenRequestHandler
// pattern) must NOT false-flag — the guard allows what it cannot prove. This
// call compiling at all is the assertion.
function genericResponseHandler<K extends string>(kind: K) {
  return defineQueryHandler({
    name: "t:query:generic",
    schema,
    handler: async () => ({ kind, ok: true }) as { kind: K; ok: boolean },
  });
}
void genericResponseHandler;

// 556/1: ContainsSecret<A | B> distributes over the union (naked type param
// in the condition) to `ContainsSecret<A> | ContainsSecret<B>` = `boolean`,
// not the literal `true` — a check written as `ContainsSecret<TData> extends
// true` silently passes a union with a leak hidden in ONE branch. Both
// assertions below must hold: the guard rejects the leaking union AND still
// accepts the clean one, proving the fix (membership form on the phantom
// param) is fail-closed for unions, not just for a bare Secret<>.
declare const leakingUnion: { ok: true } | { apiKey: Secret<string> };
// @ts-expect-error — R6: a Secret<> hidden in one union branch must still leak-guard
defineQueryHandler({
  name: "t:query:union-leak",
  schema,
  handler: async () => leakingUnion,
});

declare const cleanUnion: { ok: true } | { id: string };
defineQueryHandler({
  name: "t:query:union-clean",
  schema,
  handler: async () => cleanUnion,
});

describe("R6 ContainsSecret", () => {
  test("a clean query handler still builds — the guard param is invisible", () => {
    const def = defineQueryHandler({
      name: "t:query:clean",
      schema,
      handler: async () => ({ ok: true, value: createSecret("x").reveal() }),
    });
    expect(def.name).toBe("t:query:clean");
  });
});
