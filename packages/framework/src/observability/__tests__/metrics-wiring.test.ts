import { describe, expect, it } from "bun:test";
import * as z from "zod";
import { composeEnvSchema, readKumikoMeta } from "../../env";
import { prometheusMetricsEnvSchema, resolveObservabilityWiring } from "../metrics-wiring";

describe("resolveObservabilityWiring", () => {
  it("returns {} without a token", () => {
    expect(resolveObservabilityWiring(undefined)).toEqual({});
  });

  it("returns {} for an empty token", () => {
    expect(resolveObservabilityWiring("")).toEqual({});
  });

  it("wires a prometheus provider and metrics route when a token is set", () => {
    const token = "a".repeat(32);
    const wiring = resolveObservabilityWiring(token);

    expect("metrics" in wiring).toBe(true);
    if (!("metrics" in wiring)) throw new Error("expected wiring to include metrics");

    expect(wiring.metrics).toEqual({ path: "/metrics", token });
    expect(wiring.observability.name).toBe("prometheus");
    expect(wiring.observability.meter.snapshot()).toEqual(new Map());
  });
});

describe("prometheusMetricsEnvSchema", () => {
  it("rejects tokens shorter than 32 characters", () => {
    const result = prometheusMetricsEnvSchema.safeParse({
      PROMETHEUS_METRICS_TOKEN: "a".repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a 32-character token", () => {
    const result = prometheusMetricsEnvSchema.safeParse({
      PROMETHEUS_METRICS_TOKEN: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("accepts a missing token", () => {
    const result = prometheusMetricsEnvSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("exposes pulumi secret metadata for consumer env-schemas", () => {
    const { schema } = composeEnvSchema({
      features: [],
      extend: z.object({ FOO: z.string() }).extend(prometheusMetricsEnvSchema.shape),
    });

    const field = schema.shape["PROMETHEUS_METRICS_TOKEN"];
    if (!(field instanceof z.ZodType))
      throw new Error("expected PROMETHEUS_METRICS_TOKEN in composed schema");
    const meta = readKumikoMeta(field);
    expect(meta.pulumi?.secret).toBe(true);
    expect(meta.pulumi?.generator).toBe("openssl rand -base64 32");
  });
});
