import { describe, expect, test } from "bun:test";
import { mergeExtraContext } from "../setup-test-stack-from-features.js";

// #882/4: the integration test only asserted getFeature("config") — which
// includeBundled already provides — never that presets:["config"] actually
// merges configResolver/templateResolver into extraContext. Unit-test the merge
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

  test("config preset merges configResolver + _configAccessorFactory, keeping base-object fields", () => {
    const merged = mergeExtraContext({ foo: "bar" }, ["config"]);
    expect(typeof merged).toBe("function");
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["foo"]).toBe("bar");
    expect(result["configResolver"]).toBeDefined();
    // buildHandlerContext derives ctx.config from _configAccessorFactory, not configResolver (fw#3313).
    expect(result["_configAccessorFactory"]).toBeDefined();
  });

  test("config preset merges configResolver + _configAccessorFactory, keeping base-fn fields", () => {
    const merged = mergeExtraContext(() => ({ fromFn: 1 }), ["config"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["fromFn"]).toBe(1);
    expect(result["configResolver"]).toBeDefined();
    expect(result["_configAccessorFactory"]).toBeDefined();
  });

  test("config preset keeps a base-supplied configResolver and derives the factory from it", () => {
    const ownResolver = { get: async () => undefined } as never;
    const merged = mergeExtraContext({ configResolver: ownResolver }, ["config"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["configResolver"]).toBe(ownResolver);
    expect(result["_configAccessorFactory"]).toBeDefined();
  });

  test("config preset rejects a configResolver that is not a resolver instance", () => {
    const merged = mergeExtraContext({ configResolver: () => ({}) }, ["config"]);
    expect(() => (merged as (deps: typeof fakeDeps) => unknown)(fakeDeps)).toThrow(
      /configResolver must be a ConfigResolver/,
    );
  });

  test("template-resolver preset merges templateResolver, built from deps.db", () => {
    const merged = mergeExtraContext(undefined, ["template-resolver"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["templateResolver"]).toBeDefined();
  });

  test("both presets merge both fields", () => {
    const merged = mergeExtraContext(undefined, ["config", "template-resolver"]);
    const result = (merged as (deps: typeof fakeDeps) => Record<string, unknown>)(fakeDeps);
    expect(result["configResolver"]).toBeDefined();
    expect(result["templateResolver"]).toBeDefined();
  });
});
