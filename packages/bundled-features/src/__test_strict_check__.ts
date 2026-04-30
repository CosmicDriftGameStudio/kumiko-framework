// PROBE 3 — Vergleich: inline-generic vs. type-alias-generic via reference.

declare module "@kumiko/framework/engine" {
  interface KumikoEventTypeMap {
    "test:event:probe3": { readonly id: string };
  }
}

import type { KumikoEventTypeMap } from "@kumiko/framework/engine";

// Variante A — inline generic in einem Type-Object.
type CtxA<TMap extends object = KumikoEventTypeMap> = {
  readonly appendEvent: <K extends keyof TMap>(args: {
    type: K;
    payload: TMap[K];
  }) => Promise<void>;
};

// Variante B — type-alias als reference, generic nach außen.
type FnB<TMap extends object = KumikoEventTypeMap> = <K extends keyof TMap>(args: {
  type: K;
  payload: TMap[K];
}) => Promise<void>;

type CtxB<TMap extends object = KumikoEventTypeMap> = {
  readonly appendEvent: FnB<TMap>;
};

declare const ctxA: CtxA;
declare const ctxB: CtxB;

export async function tryA() {
  await ctxA.appendEvent({
    type: "test:event:probe3",
    payload: { id: "x" },
  });
}

export async function tryB() {
  await ctxB.appendEvent({
    type: "test:event:probe3",
    payload: { id: "x" },
  });
}

export {};
