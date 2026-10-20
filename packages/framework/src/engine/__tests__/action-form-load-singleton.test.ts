import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function settingsFeature(load: { readonly singleton?: boolean; readonly idParam?: string }) {
  return defineFeature("app", (r) => {
    r.queryHandler({
      name: "settings",
      schema: z.object({}),
      handler: async () => ({ domain: "status.example.de" }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.writeHandler({
      name: "save-settings",
      schema: z.object({ domain: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "settings",
      type: "actionForm",
      handler: "app:write:save-settings",
      fields: { domain: { type: "text", required: true } },
      layout: { sections: [{ fields: ["domain"] }] },
      load: { query: "app:query:settings", ...load },
    });
  });
}

describe("validateBoot — actionForm load.singleton", () => {
  test("singleton + idParam throws", () => {
    expect(() => validateBoot([settingsFeature({ singleton: true, idParam: "tenantId" })])).toThrow(
      /Screen "settings" \(actionForm\) sets both load\.singleton: true and load\.idParam/,
    );
  });

  test("singleton without idParam boots cleanly", () => {
    expect(() => validateBoot([settingsFeature({ singleton: true })])).not.toThrow();
  });

  test("idParam without singleton still boots", () => {
    expect(() => validateBoot([settingsFeature({ idParam: "tenantId" })])).not.toThrow();
  });
});
