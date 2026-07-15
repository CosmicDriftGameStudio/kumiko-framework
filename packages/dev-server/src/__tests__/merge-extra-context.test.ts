import { describe, expect, test } from "bun:test";
import { mergeExtraContext } from "../setup-test-stack-from-features";

// #882/4: the integration test only asserted getFeature("config") — which
// includeBundled already provides — never that presets:["config"] actually
// merges configResolver/textContent into extraContext. Unit-test the merge
// directly instead.

const fakeDeps = {
  registry: {} as never,
  db: { marker: "fake-db" } as never,
  sseBroker: {} as never,
  redis: {} as never,
};

describe("mergeExtraContext", () => {
  test("no presets → returns base untouched (function passthrough)", () => {
    const base = () => ({ foo: "bar" });
    const merged = mergeExtraContext(base, []);
    expect(merged).toBe(base);
  });

  test("no presets → returns base untouched (object passthrough)", () => {
    const base = { foo: "bar" };
    const merged = mergeExtraContext(base, []);
    expect(merged).toBe(base);
  });

  test("config preset merges configResolver, keeping base-object fields", () => {
    const merged = mergeExtraContext({ foo: "bar" }, ["config"]);
    expect(typeof merged).toBe("function");
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["foo"]).toBe("bar");
    expect(result["configResolver"]).toBeDefined();
  });

  test("config preset merges configResolver, keeping base-fn fields", () => {
    const merged = mergeExtraContext(() => ({ fromFn: 1 }), ["config"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["fromFn"]).toBe(1);
    expect(result["configResolver"]).toBeDefined();
  });

  test("text-content preset merges textContent, built from deps.db", () => {
    const merged = mergeExtraContext(undefined, ["text-content"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["textContent"]).toBeDefined();
  });

  test("both presets merge both fields", () => {
    const merged = mergeExtraContext(undefined, ["config", "text-content"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["configResolver"]).toBeDefined();
    expect(result["textContent"]).toBeDefined();
  });
});
