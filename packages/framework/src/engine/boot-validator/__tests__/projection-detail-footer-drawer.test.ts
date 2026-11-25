import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

type FooterDrawerFixture = {
  readonly screenActionIds?: readonly string[];
  readonly drawerId?: string;
  readonly saveId?: string;
  readonly savePayloadPick?: readonly string[];
  readonly drawerParams?: { readonly pick: readonly string[] };
  readonly targetFields?: Record<string, unknown>;
  readonly targetLayoutFields?: readonly unknown[];
  readonly targetLoad?: boolean;
};

function footerDrawerFeature(fixture: FooterDrawerFixture) {
  const {
    screenActionIds = [],
    drawerId = "send-note",
    saveId = "save",
    savePayloadPick,
    drawerParams,
    targetFields = { memo: { type: "text" } },
    targetLayoutFields = ["memo"],
    targetLoad = false,
  } = fixture;
  return defineFeature("shop", (r) => {
    registerStubQueryHandler(r, "order-detail");
    registerStubQueryHandler(r, "note-detail");
    r.writeHandler({
      name: "save",
      schema: z.object({ id: z.string(), memo: z.string().optional() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN,
    });
    r.writeHandler({
      name: "add-note",
      schema: z.object({ memo: z.string().optional() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN,
    });
    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "shop:query:order-detail",
      actions: screenActionIds.map((id) => ({
        kind: "navigate",
        id,
        label: "actions.go",
        icon: "lock",
        screen: "note-form",
      })),
      layout: {
        sections: [
          { fields: ["total"] },
          {
            id: "footer",
            kind: "writeForm",
            placement: "footer",
            fieldDefs: { memo: { type: "text" } },
            fields: ["memo"],
            actions: [
              {
                kind: "writeHandler",
                id: saveId,
                label: "actions.save",
                handler: "shop:write:save",
                ...(savePayloadPick !== undefined && { payload: { pick: [...savePayloadPick] } }),
              },
              {
                kind: "drawer",
                id: drawerId,
                label: "actions.sendNote",
                screen: "note-form",
                ...(drawerParams !== undefined && { params: drawerParams }),
              },
            ],
          },
        ],
      },
    } as never);
    r.screen({
      id: "note-form",
      type: "actionForm",
      handler: "shop:write:add-note",
      fields: targetFields,
      layout: { sections: [{ fields: targetLayoutFields }] },
      ...(targetLoad && { load: { query: "shop:query:note-detail" } }),
    } as never);
  });
}

describe("footer form drawer actions", () => {
  test("a drawer target listing every footer field boots", () => {
    expect(() => validateBoot([footerDrawerFeature({})])).not.toThrow();
  });

  test("a footer field the target lists with visible: false still counts", () => {
    expect(() =>
      validateBoot([
        footerDrawerFeature({ targetLayoutFields: [{ field: "memo", visible: false }] }),
      ]),
    ).not.toThrow();
  });

  test("a footer drawer action reusing a screen action id is rejected like a writeHandler one", () => {
    expect(() => validateBoot([footerDrawerFeature({ screenActionIds: ["send-note"] })])).toThrow(
      /action "send-note" has the id of an action of the screen/,
    );
    expect(() => validateBoot([footerDrawerFeature({ screenActionIds: ["save"] })])).toThrow(
      /action "save" has the id of an action of the screen/,
    );
  });

  test("a drawer params key equal to a footer field is rejected, other keys boot", () => {
    expect(() =>
      validateBoot([
        footerDrawerFeature({
          drawerParams: { pick: ["memo"] },
          targetFields: { memo: { type: "text" } },
        }),
      ]),
    ).toThrow(/field "memo", which action "send-note" also sends in its payload/);
    expect(() =>
      validateBoot([
        footerDrawerFeature({
          drawerParams: { pick: ["orderRef"] },
          targetFields: { memo: { type: "text" }, orderRef: { type: "text" } },
          targetLayoutFields: ["memo", "orderRef"],
        }),
      ]),
    ).not.toThrow();
  });

  test("a target without the footer field in its layout is rejected", () => {
    expect(() =>
      validateBoot([
        footerDrawerFeature({
          targetFields: { memo: { type: "text" }, other: { type: "text" } },
          targetLayoutFields: ["other"],
        }),
      ]),
    ).toThrow(/does not list the footer field\(s\) "memo"/);
  });

  test("a target marking the footer field sensitive or password is rejected", () => {
    expect(() =>
      validateBoot([
        footerDrawerFeature({ targetFields: { memo: { type: "text", sensitive: true } } }),
      ]),
    ).toThrow(/marks the footer field "memo" as sensitive or password/);
    expect(() =>
      validateBoot([
        footerDrawerFeature({ targetFields: { memo: { type: "text", format: "password" } } }),
      ]),
    ).toThrow(/marks the footer field "memo" as sensitive or password/);
  });

  test("a target with load is rejected", () => {
    expect(() => validateBoot([footerDrawerFeature({ targetLoad: true })])).toThrow(
      /which declares load/,
    );
  });
});
