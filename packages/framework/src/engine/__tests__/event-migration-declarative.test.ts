import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature";
import type { DeclarativeEventMigration, EventUpcastCtx } from "../types";

// Transforms under test are pure — ctx is never touched.
const upcastCtx = {} as EventUpcastCtx;

function compile(spec: DeclarativeEventMigration) {
  const feature = defineFeature("billing", (r) => {
    r.eventMigration("invoicePaid", 1, 2, spec);
  });
  const def = feature.eventMigrations["invoicePaid"]?.[0];
  if (!def) throw new Error("migration not registered");
  return (payload: unknown) => def.transform(payload, upcastCtx);
}

describe("declarative eventMigration", () => {
  test("rename moves the value and drops the old key; missing source is a no-op", async () => {
    const run = compile({ rename: { amount: "amountCents", missing: "other" } });
    expect(await run({ amount: 5, currency: "EUR" })).toEqual({
      amountCents: 5,
      currency: "EUR",
    });
  });

  test("default fills absent keys only — existing values win", async () => {
    const run = compile({ default: { currency: "EUR", status: "open" } });
    expect(await run({ currency: "CHF" })).toEqual({ currency: "CHF", status: "open" });
  });

  test("map runs after rename on the new key; absent keys are skipped", async () => {
    const run = compile({
      rename: { amount: "amountCents" },
      map: { amountCents: (v) => Math.round(Number(v) * 100), missing: () => "never" },
    });
    expect(await run({ amount: 19.99 })).toEqual({ amountCents: 1999 });
  });

  test("non-object payload fails loud", () => {
    const run = compile({ default: { a: 1 } });
    expect(() => run("not-an-object")).toThrow(/object payload/);
    expect(() => run([1, 2])).toThrow(/object payload/);
  });

  test("imperative function variant is stored untouched", () => {
    const fn = (payload: unknown) => payload;
    const feature = defineFeature("billing", (r) => {
      r.eventMigration("invoicePaid", 1, 2, fn);
    });
    expect(feature.eventMigrations["invoicePaid"]?.[0]?.transform).toBe(fn);
  });
});
