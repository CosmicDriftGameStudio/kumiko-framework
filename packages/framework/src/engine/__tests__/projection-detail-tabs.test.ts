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

  test("mode: tabs on entityEdit throws — tabs are projectionDetail-only", () => {
    const feature = defineFeature("app", (r) => {
      r.entity("rent", createEntity({ fields: { name: createTextField() } }));
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
    expect(() => validateBoot([feature])).toThrow(
      /Screen "rent-edit" \(entityEdit\) sets mode: "tabs" — tabs are only supported on projectionDetail/,
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

  test("valid tabs + header + metrics declaration boots cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("rent:detail", z.object({}), async () => ({ description: "x" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        header: { title: "name", subtitle: "address", status: "state" },
        metrics: ["balance", "overdueDays"],
        fieldLabels: { balance: "rent.balance", overdueDays: "rent.overdueDays" },
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
