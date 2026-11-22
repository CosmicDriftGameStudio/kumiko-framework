// A real boot (setupTestStack) accepts success* next to a redirect that sets
// onlyWith and rejects the same screen without it.

import { describe, expect, test } from "bun:test";
import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";

function makeFeature(withOnlyWith: boolean) {
  return defineFeature("redirect-probe", (r) => {
    r.writeHandler({
      name: "send",
      schema: z.object({ note: z.string() }),
      access: { roles: ["User"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    r.translations({
      keys: {
        "screen:cockpit.title": { de: "Cockpit", en: "Cockpit" },
        "screen:send-form.title": { de: "Senden", en: "Send" },
        "redirect-probe:entity:__action-form__:field:note": { de: "Notiz", en: "Note" },
        "redirect-probe.fact.sent": { de: "Gesendet", en: "Sent" },
      },
    });
    r.screen({ id: "cockpit", type: "custom", renderer: { react: "stub" } });
    r.screen({
      id: "send-form",
      type: "actionForm",
      handler: "redirect-probe:write:send",
      fields: { note: { type: "text" } },
      layout: { sections: [{ fields: ["note"] }] },
      redirect: {
        screen: "cockpit",
        searchParams: { cmd: "commandId" },
        ...(withOnlyWith && { onlyWith: "commandId" }),
      },
      successFacts: [{ field: "sent", label: "redirect-probe.fact.sent" }],
    });
  });
}

describe("actionForm redirect.onlyWith at boot", () => {
  test("success facts next to a redirect with onlyWith boot", async () => {
    const stack = await setupTestStack({ features: [makeFeature(true)], validateBoot: "full" });
    await stack.cleanup();
  });

  test("the same screen without onlyWith fails the boot", async () => {
    await expect(
      setupTestStack({ features: [makeFeature(false)], validateBoot: "full" }),
    ).rejects.toThrow(/form\/success-facts-with-redirect|sets both redirect and successFacts/);
  });
});
