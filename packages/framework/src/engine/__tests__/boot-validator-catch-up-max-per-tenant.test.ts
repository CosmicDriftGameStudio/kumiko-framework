import { describe, expect, test } from "bun:test";
import type { JobDefinition } from "@cosmicdrift/kumiko-types/config";
import * as z from "zod";
import { createRegistry, defineFeature } from "../index.ts";

function registryWith(maxPerTenant: JobDefinition["maxPerTenant"]) {
  return createRegistry([
    defineFeature("replay-cap", (r) => {
      const ping = r.defineEvent("ping", z.object({}), { piiFields: "none" });
      r.job(
        "on-ping",
        { trigger: { on: ping.name, catchUp: true }, runIn: "worker", maxPerTenant },
        async () => {},
      );
    }),
  ]);
}

describe("trigger.catchUp with maxPerTenant", () => {
  test("rejects onLimit skip, including the plain-number shorthand", () => {
    expect(() => registryWith(2)).toThrow(/catchUp with maxPerTenant onLimit "skip"/);
    expect(() => registryWith({ limit: 2, onLimit: "skip" })).toThrow(
      /replay must not discard history/,
    );
  });

  test("accepts onLimit defer and no cap", () => {
    expect(() => registryWith({ limit: 2, onLimit: "defer" })).not.toThrow();
    expect(() => registryWith(undefined)).not.toThrow();
  });
});
