import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// Akten-Layout: projectionDetail `layout.mode: "tabs"` + `header`/`metrics`.
describe("validateBoot — projectionDetail tabs (fw record-layout)", () => {
  test("mode: tabs with only one section throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          mode: "tabs",
          sections: [{ id: "overview", title: "Overview", fields: ["description"] }],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/tabs need at least 2 sections/);
  });

  test("tabs section without a title throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", fields: ["description"] },
            { id: "history", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sections\[0\] has no title/);
  });

  test("tabs section without an id throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          mode: "tabs",
          sections: [
            { title: "Overview", fields: ["description"] },
            { id: "history", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sections\[0\] \("Overview"\) has no id/);
  });

  test("tabs section id that is not kebab-case throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "Overview", title: "Overview", fields: ["description"] },
            { id: "history", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/must be kebab-case/);
  });

  test("duplicate tab ids throw", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["description"] },
            { id: "overview", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/duplicate tab id "overview"/);
  });

  // fw#3134: entityEdit joined projectionDetail as a tabs host. It renders
  // every tab mounted and validates across all of them on submit, so a
  // required field on an unopened tab surfaces instead of blocking silently.
  test("mode: tabs on entityEdit boots", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "rent",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", columns: 1, fields: ["name"] },
            { id: "history", title: "History", columns: 1, fields: ["name"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("mode: tabs on entityEdit enforces the same per-tab id as projectionDetail", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "rent",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: {
          mode: "tabs",
          sections: [
            { title: "Overview", columns: 1, fields: ["name"] },
            { id: "history", title: "History", columns: 1, fields: ["name"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "rent-edit" \(entityEdit\).*sections\[0\] \("Overview"\) has no id/s,
    );
  });

  test("mode: tabs on entityEdit with a single section throws", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "rent",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: {
          mode: "tabs",
          sections: [{ id: "overview", title: "Overview", columns: 1, fields: ["name"] }],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/tabs need at least 2 sections/);
  });

  // The other three edit-screen types have no jump-to-erroring-tab path, so a
  // required field on a hidden tab would still block their submit in silence.
  test("mode: tabs on actionForm still throws", () => {
    const feature = defineFeature("app", (r) => {
      r.writeHandler(
        "archive",
        z.object({ reason: z.string() }),
        async () => ({ isSuccess: true as const, data: {} }),
        { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
      );
      r.screen({
        id: "rent-action",
        type: "actionForm",
        handler: "app:write:archive",
        fields: { reason: { type: "text" } } as never,
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", columns: 1, fields: ["reason"] },
            { id: "history", title: "History", columns: 1, fields: ["reason"] },
          ] as never,
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "rent-action" \(actionForm\) sets mode: "tabs" — tabs are only supported on projectionDetail and entityEdit/,
    );
  });

  test("metric without a fieldLabels entry throws — no fallback to the raw column name", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        metrics: ["balance"],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/metric "balance" has no entry in fieldLabels/);
  });

  test("object-form metric with its own label needs no fieldLabels entry", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("rent:detail", z.object({}), async () => ({ description: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        metrics: [{ field: "balance", label: "rent.balance" }],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("object-form metric with neither its own label nor a fieldLabels entry throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        metrics: [{ field: "balance" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /metric "balance" has no entry in fieldLabels and no own "label"/,
    );
  });

  test("metric navigate.tab with no screen/entity — unknown section id throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        metrics: [{ field: "balance", label: "rent.balance", navigate: { tab: "unknown" } }],
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["description"] },
            { id: "history", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /navigates to tab "unknown", which is not a section id on this screen/,
    );
  });

  test("metric navigate.tab with no screen/entity — a known section id boots cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("rent:detail", z.object({}), async () => ({ description: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        metrics: [{ field: "balance", label: "rent.balance", navigate: { tab: "history" } }],
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["description"] },
            { id: "history", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("valid tabs + header + metrics declaration boots cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("rent:detail", z.object({}), async () => ({ description: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        header: { title: "name", subtitle: "address", status: "state" },
        metrics: ["balance", { field: "overdueDays", label: "rent.overdueDays" }],
        fieldLabels: { balance: "rent.balance" },
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["description"] },
            { id: "history", title: "History", fields: ["notes"] },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
