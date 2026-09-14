import { describe, expect, test } from "bun:test";
import { createApp, createRegistry, dedupeFeatures, defineFeature } from "../index";

describe("dedupeFeatures", () => {
  test("same reference mounted twice collapses to one entry, order preserved", () => {
    const shared = defineFeature("shared", () => {});
    const other = defineFeature("other", () => {});

    const result = dedupeFeatures([shared, other, shared]);

    expect(result).toEqual([shared, other]);
    expect(result[0]).toBe(shared);
  });

  test("registry builds when the same reference is mounted twice", () => {
    const shared = defineFeature("shared", () => {});

    expect(() => createRegistry([shared, shared])).not.toThrow();
  });

  test("two instances with shallow-equal dedupeOptions collapse — first instance kept", () => {
    const a = defineFeature("x", () => {}, { dedupeOptions: { limit: 3 } });
    const b = defineFeature("x", () => {}, { dedupeOptions: { limit: 3 } });
    const other = defineFeature("y", () => {});

    const result = dedupeFeatures([a, other, b]);

    expect(result).toEqual([a, other]);
    expect(result[0]).toBe(a);
  });

  test("differing primitive dedupeOptions throws with a 'different options' message", () => {
    const a = defineFeature("x", () => {}, { dedupeOptions: { limit: 3 } });
    const b = defineFeature("x", () => {}, { dedupeOptions: { limit: 5 } });

    expect(() => dedupeFeatures([a, b])).toThrow(/Duplicate feature: "x".*different options/);
  });

  test("same function reference in dedupeOptions collapses", () => {
    const onTrigger = () => {};
    const a = defineFeature("x", () => {}, { dedupeOptions: { onTrigger } });
    const b = defineFeature("x", () => {}, { dedupeOptions: { onTrigger } });

    const result = dedupeFeatures([a, b]);

    expect(result).toEqual([a]);
  });

  test("different function reference in dedupeOptions throws", () => {
    const a = defineFeature("x", () => {}, { dedupeOptions: { onTrigger: () => {} } });
    const b = defineFeature("x", () => {}, { dedupeOptions: { onTrigger: () => {} } });

    expect(() => dedupeFeatures([a, b])).toThrow(/Duplicate feature: "x".*different options/);
  });

  test("{ a: undefined } and {} are treated as shallow-equal (missing key == undefined)", () => {
    const a = defineFeature("x", () => {}, { dedupeOptions: { a: undefined } });
    const b = defineFeature("x", () => {}, { dedupeOptions: {} });

    const result = dedupeFeatures([a, b]);

    expect(result).toEqual([a]);
  });

  test("two distinct instances with no dedupeOptions throw with a 'distinct instances' message", () => {
    const a = defineFeature("x", () => {});
    const b = defineFeature("x", () => {});

    expect(() => dedupeFeatures([a, b])).toThrow(
      /Duplicate feature: "x" mounted twice as distinct instances/,
    );
  });

  test("createApp boots end-to-end with a feature mounted twice via dedupeOptions", () => {
    const a = defineFeature("x", () => {}, { dedupeOptions: {} });
    const b = defineFeature("x", () => {}, { dedupeOptions: {} });

    expect(() =>
      createApp({
        roles: ["Admin"],
        features: [a, b],
      }),
    ).not.toThrow();
  });
});
