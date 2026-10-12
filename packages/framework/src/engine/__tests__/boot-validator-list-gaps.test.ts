import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

function bootMessage(feature: Parameters<typeof validateBoot>[0][number]): string {
  try {
    validateBoot(withBootValidatorFixture([feature]));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
}

const ADMIN_ACCESS = { roles: ["Admin"] } as const;

function registerHandlers(r: Parameters<Parameters<typeof defineFeature>[1]>[0], writes: string[]) {
  r.queryHandler("order:detail", z.object({}), async () => ({ total: 1 }), {
    access: ADMIN_ACCESS,
  });
  for (const write of writes) {
    r.writeHandler(write, z.object({}), async () => ({ isSuccess: true as const, data: null }), {
      access: ADMIN_ACCESS,
    });
  }
}

const detailSections = { sections: [{ title: "s", fields: ["total"] }] };

function featureWithDetail(
  screen: { primaryAction?: string; detailFor?: string },
  withEdit = false,
) {
  return defineFeature("shop", (r) => {
    r.entity(
      "order",
      createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    registerHandlers(r, ["activate"]);
    if (withEdit) {
      r.screen({
        id: "order-edit",
        type: "entityEdit",
        entity: "order",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    }
    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "shop:query:order:detail",
      layout: detailSections,
      actions: [
        {
          kind: "writeHandler",
          id: "activate",
          icon: "check",
          label: "actions.activate",
          handler: "shop:write:activate",
        },
      ],
      ...screen,
    });
  });
}

describe("validateBoot — projectionDetail primaryAction", () => {
  test("a declared action id is accepted", () => {
    expect(bootMessage(featureWithDetail({ primaryAction: "activate" }))).toBe("");
  });

  test("an id matching no action throws and lists the declared ids", () => {
    expect(bootMessage(featureWithDetail({ primaryAction: "ghost" }))).toMatch(
      /primaryAction "ghost" matches no action.*activate/,
    );
  });

  test('"edit" without detailFor throws', () => {
    expect(bootMessage(featureWithDetail({ primaryAction: "edit" }))).toMatch(
      /primaryAction "edit" matches no action.*needs detailFor/,
    );
  });

  test('"edit" with detailFor is accepted', () => {
    expect(
      bootMessage(featureWithDetail({ primaryAction: "edit", detailFor: "order" }, true)),
    ).toBe("");
  });
});

describe("validateBoot — list emptyState", () => {
  function listWithEmptyAction(actionId: string) {
    return defineFeature("shop", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      registerHandlers(r, ["sync"]);
      r.screen({
        id: "order-list",
        type: "entityList",
        entity: "order",
        columns: ["name"],
        emptyState: {
          title: "shop.empty.title",
          action: { kind: "writeHandler", id: actionId, label: "x", handler: "shop:write:sync" },
        },
      });
    });
  }

  test("an emptyState action without a resolvable icon throws", () => {
    expect(bootMessage(listWithEmptyAction("custom-thing"))).toMatch(
      /emptyState action "custom-thing" has no resolvable icon/,
    );
  });

  test("an emptyState action whose id resolves a default icon passes the icon check", () => {
    expect(bootMessage(listWithEmptyAction("create"))).toBe("");
  });
});

describe("validateBoot — redirect tab", () => {
  function featureWithRedirectTab(tab: string) {
    return defineFeature("shop", (r) => {
      registerHandlers(r, ["archive"]);
      r.screen({
        id: "order-target",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["total"] },
            { id: "payments", title: "Payments", fields: ["total"] },
          ],
        },
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: detailSections,
        actions: [
          {
            kind: "writeHandler",
            id: "archive",
            icon: "x",
            label: "actions.archive",
            handler: "shop:write:archive",
            redirect: { screen: "order-target", idFrom: "id", tab },
          },
        ],
      });
    });
  }

  test("a section id of the target tabs screen is accepted", () => {
    expect(bootMessage(featureWithRedirectTab("payments"))).toBe("");
  });

  test("an unknown tab throws", () => {
    expect(bootMessage(featureWithRedirectTab("ghost"))).toMatch(/tab "ghost"/);
  });
});
