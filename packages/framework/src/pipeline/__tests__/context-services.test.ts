import { describe, expect, test } from "bun:test";
import type { AppContext } from "../../engine/types/index.ts";
import { APP_CONTEXT_KEY_ROLES, buildContextServices } from "../context-services.ts";

const SERVICE_KEYS = Object.entries(APP_CONTEXT_KEY_ROLES)
  .filter(([, role]) => role === "service")
  .map(([key]) => key);

const WIRING_KEYS = Object.entries(APP_CONTEXT_KEY_ROLES)
  .filter(([, role]) => role === "wiring")
  .map(([key]) => key);

// Each key gets a distinct sentinel so a mix-up between two services shows up.
function contextWith(keys: readonly string[]): AppContext {
  // @cast-boundary test stub — the values are sentinels, buildContextServices never calls them.
  return Object.fromEntries(keys.map((key) => [key, { sentinel: key }])) as AppContext;
}

describe("buildContextServices", () => {
  test("copies every service-role key of the boot context", () => {
    const services = buildContextServices(contextWith(SERVICE_KEYS));

    const perCallFactories = ["_notifyInTransactionFactory", "_notifyAfterCommitFactory"];
    for (const key of SERVICE_KEYS.filter((entry) => !perCallFactories.includes(entry))) {
      expect(Reflect.get(services, key)).toEqual({ sentinel: key });
    }
  });

  test("never exposes wiring keys, neither flat nor in extensions", () => {
    const services = buildContextServices(contextWith(WIRING_KEYS));

    for (const key of WIRING_KEYS) {
      expect(Object.hasOwn(services, key)).toBe(false);
      expect(Object.hasOwn(services.extensions, key)).toBe(false);
    }
  });

  test("moves keys the framework does not know into extensions", () => {
    const context: AppContext = Object.assign(contextWith(["redis"]), {
      templateResolver: { sentinel: "templateResolver" },
    });

    const services = buildContextServices(context);

    expect(services.extensions).toEqual({ templateResolver: { sentinel: "templateResolver" } });
    expect(Object.hasOwn(services, "templateResolver")).toBe(false);
  });

  test("overrides win over the boot context", () => {
    const fromContext = { sentinel: "context" };
    const fromOverride = { sentinel: "override" };
    // @cast-boundary test stub — sentinels stand in for a file context
    const context = { files: fromContext } as unknown as AppContext;

    // @cast-boundary test stub — sentinels stand in for a file context
    const services = buildContextServices(context, { files: fromOverride as never });

    expect(services.files).toBe(fromOverride as never);
  });

  test("a per-call notify factory of the boot context does not leak into the services", () => {
    const factory = () => async () => ({});
    // @cast-boundary test stub — only the key presence matters
    const context = {
      _notifyInTransactionFactory: factory,
      _notifyAfterCommitFactory: factory,
    } as unknown as AppContext;

    expect(Object.hasOwn(buildContextServices(context), "_notifyInTransactionFactory")).toBe(false);
    expect(Object.hasOwn(buildContextServices(context), "_notifyAfterCommitFactory")).toBe(false);
  });

  test("a per-call notify factory handed in as override is exposed", () => {
    // @cast-boundary test stub — only identity matters
    const factory = (() => async () => ({})) as never;

    const services = buildContextServices({}, { _notifyAfterCommitFactory: factory });

    expect(services._notifyAfterCommitFactory).toBe(factory);
  });

  test("keys that are absent stay absent instead of becoming undefined entries", () => {
    const services = buildContextServices(contextWith(["redis"]));

    expect(Object.keys(services).sort()).toEqual(["extensions", "redis"]);
  });
});
