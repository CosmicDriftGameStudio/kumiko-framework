import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function buildFeature(options: {
  readonly detailTabs: boolean;
  readonly tab: string;
  readonly via: "entityEditSection" | "entityListRowAction";
}) {
  return defineFeature("app", (r) => {
    r.entity(
      "vehicle",
      createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.queryHandler("vehicle:detail", z.object({}), async () => ({ name: "x" }), {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "vehicle-detail",
      type: "projectionDetail",
      query: "app:query:vehicle:detail",
      layout: options.detailTabs
        ? {
            mode: "tabs",
            sections: [
              { id: "overview", title: "Overview", fields: ["name"] },
              { id: "channels", title: "Channels", fields: ["name"] },
            ],
          }
        : { sections: [{ title: "Overview", fields: ["name"] }] },
    });
    const navigateAction = {
      kind: "navigate" as const,
      id: "view-channels",
      label: "app.actions.viewChannels",
      screen: "vehicle-detail",
      tab: options.tab,
    };
    if (options.via === "entityEditSection") {
      r.screen({
        id: "vehicle-edit",
        type: "entityEdit",
        entity: "vehicle",
        layout: {
          sections: [
            {
              id: "main",
              title: "Main",
              columns: 1,
              fields: ["name"],
              actions: [{ ...navigateAction, entityId: "vehicleId" }],
            },
          ],
        },
      });
    } else {
      r.screen({
        id: "vehicle-list",
        type: "entityList",
        entity: "vehicle",
        columns: ["name"],
        rowActions: [navigateAction],
      });
    }
  });
}

describe("validateBoot — RowActionNavigate.tab", () => {
  test("entityEdit section action navigates to a known tab boots cleanly", () => {
    const feature = buildFeature({ detailTabs: true, tab: "channels", via: "entityEditSection" });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("entityEdit section action navigates to an unknown tab throws", () => {
    const feature = buildFeature({ detailTabs: true, tab: "unknown", via: "entityEditSection" });
    expect(() => validateBoot([feature])).toThrow(
      /navigates to tab "unknown", which is not a section id on target screen/,
    );
  });

  test("entityEdit section action navigating to a non-tabs projectionDetail throws", () => {
    const feature = buildFeature({ detailTabs: false, tab: "overview", via: "entityEditSection" });
    expect(() => validateBoot([feature])).toThrow(
      /is not a projectionDetail with layout.mode "tabs"/,
    );
  });

  test("entityList rowAction navigating to an unknown tab throws (central resolution path)", () => {
    const feature = buildFeature({
      detailTabs: true,
      tab: "unknown",
      via: "entityListRowAction",
    });
    expect(() => validateBoot([feature])).toThrow(
      /navigates to tab "unknown", which is not a section id on target screen/,
    );
  });
});
