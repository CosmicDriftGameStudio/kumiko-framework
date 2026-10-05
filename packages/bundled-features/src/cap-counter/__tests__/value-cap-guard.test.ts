import { describe, expect, test } from "bun:test";
import { readPayloadField } from "../payload-field.js";
import type { CapGuardContext } from "../stock-cap-guard.js";
import { createValueCapGuard } from "../value-cap-guard.js";

type Caps = { readonly minDays?: number; readonly maxDays?: number };

const ctx: CapGuardContext = { db: null as never };
const SPEC_BASE = { field: "days", code: "days_out_of_range", i18nKey: "cap.days" } as const;

function guardFor(caps: Caps) {
  return createValueCapGuard<Caps>(async () => caps);
}

describe("checkValueCap bounds", () => {
  test("max only: above is rejected with field, value and bounds, at the limit passes", async () => {
    const { checkValueCap } = guardFor({ maxDays: 30 });
    const spec = { ...SPEC_BASE, max: (caps: Caps) => caps.maxDays };
    expect(await checkValueCap(ctx, 30, spec)).toBeNull();
    const failure = await checkValueCap(ctx, 31, spec);
    expect(failure?.isSuccess).toBe(false);
    expect(failure?.error).toMatchObject({
      i18nKey: "cap.days",
      details: { field: "days", value: 31, max: 30 },
    });
  });

  test("min only: below is rejected, at the limit passes", async () => {
    const { checkValueCap } = guardFor({ minDays: 7 });
    const spec = { ...SPEC_BASE, min: (caps: Caps) => caps.minDays };
    expect(await checkValueCap(ctx, 7, spec)).toBeNull();
    expect((await checkValueCap(ctx, 6, spec))?.isSuccess).toBe(false);
  });

  test("both bounds: only values inside the range pass", async () => {
    const { checkValueCap } = guardFor({ minDays: 7, maxDays: 30 });
    const spec = {
      ...SPEC_BASE,
      min: (caps: Caps) => caps.minDays,
      max: (caps: Caps) => caps.maxDays,
    };
    expect(await checkValueCap(ctx, 7, spec)).toBeNull();
    expect(await checkValueCap(ctx, 30, spec)).toBeNull();
    expect((await checkValueCap(ctx, 6, spec))?.isSuccess).toBe(false);
    expect((await checkValueCap(ctx, 31, spec))?.isSuccess).toBe(false);
  });

  test("undefined bounds are unbounded", async () => {
    const { checkValueCap } = guardFor({});
    const spec = {
      ...SPEC_BASE,
      min: (caps: Caps) => caps.minDays,
      max: (caps: Caps) => caps.maxDays,
    };
    expect(await checkValueCap(ctx, -1_000_000, spec)).toBeNull();
    expect(await checkValueCap(ctx, 1_000_000, spec)).toBeNull();
  });

  test("absent and non-numeric values pass without resolving caps", async () => {
    let resolved = 0;
    const { checkValueCap } = createValueCapGuard<Caps>(async () => {
      resolved += 1;
      return { maxDays: 1 };
    });
    const spec = { ...SPEC_BASE, max: (caps: Caps) => caps.maxDays };
    expect(await checkValueCap(ctx, undefined, spec)).toBeNull();
    expect(await checkValueCap(ctx, null, spec)).toBeNull();
    expect(await checkValueCap(ctx, "99", spec)).toBeNull();
    expect(resolved).toBe(0);
  });
});

describe("readPayloadField", () => {
  test("reads a flat create payload and the changes of an update payload", () => {
    expect(readPayloadField({ days: 5 }, "days")).toBe(5);
    expect(readPayloadField({ id: "x", version: 1, changes: { days: 9 } }, "days")).toBe(9);
  });

  test("a missing field or a payload of another shape yields undefined", () => {
    expect(readPayloadField({ changes: { other: 1 } }, "days")).toBeUndefined();
    expect(readPayloadField({ changes: "nope" }, "days")).toBeUndefined();
    expect(readPayloadField(null, "days")).toBeUndefined();
    expect(readPayloadField([1], "days")).toBeUndefined();
  });
});
