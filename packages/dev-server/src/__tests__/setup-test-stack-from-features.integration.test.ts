import { describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStackFromFeatures } from "../setup-test-stack-from-features";

const noopFeature = defineFeature("noop-app", () => {});

describe("setupTestStackFromFeatures", () => {
  test("includeBundled prepends config/user/tenant/auth", async () => {
    const stack = await setupTestStackFromFeatures([noopFeature], { includeBundled: true });
    try {
      for (const name of ["config", "user", "tenant", "auth-email-password", "noop-app"]) {
        expect(stack.registry.getFeature(name)).toBeDefined();
      }
    } finally {
      await stack.cleanup();
    }
  });

  test("config preset wires configResolver in extraContext", async () => {
    const stack = await setupTestStackFromFeatures([noopFeature], {
      includeBundled: true,
      presets: ["config"],
    });
    try {
      expect(stack.registry.getFeature("config")).toBeDefined();
    } finally {
      await stack.cleanup();
    }
  });
});
