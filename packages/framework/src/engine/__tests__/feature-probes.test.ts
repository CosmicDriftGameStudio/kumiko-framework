import { describe, expect, test } from "bun:test";
import type { ProbeOptions } from "@cosmicdrift/kumiko-types/probe";
import { defineFeature } from "../define-feature.ts";

const baseProbe: ProbeOptions = {
  name: "mail",
  scope: "tenant",
  cost: "free",
  area: "probe.area",
  label: "probe.label",
  run: async () => ({ status: "ok", message: { key: "probe.ok" } }),
};

function featureWith(...probes: ProbeOptions[]) {
  return defineFeature("probe-host", (r) => {
    for (const probe of probes) r.probe(probe);
  });
}

describe("r.probe", () => {
  test("registers the probe under its probe QN", () => {
    const feature = featureWith(baseProbe);
    expect(feature.probes?.["mail"]?.qualifiedName).toBe("probe-host:probe:mail");
    expect(feature.probes?.["mail"]?.scope).toBe("tenant");
  });

  test("a feature without probes exposes no probes map", () => {
    expect(defineFeature("no-probes", () => {}).probes).toBeUndefined();
  });

  test("rejects a duplicate probe name", () => {
    expect(() => featureWith(baseProbe, baseProbe)).toThrow(
      '[Feature probe-host] Probe "mail" already registered',
    );
  });

  test("rejects a non-kebab name", () => {
    expect(() => featureWith({ ...baseProbe, name: "Bad_Name" })).toThrow("must be kebab-case");
  });

  test("rejects a non-positive timeout", () => {
    expect(() => featureWith({ ...baseProbe, timeoutMs: 0 })).toThrow("timeoutMs must be > 0");
  });

  test("rejects an empty area key", () => {
    expect(() => featureWith({ ...baseProbe, area: "" })).toThrow("area must be a non-empty");
  });
});
