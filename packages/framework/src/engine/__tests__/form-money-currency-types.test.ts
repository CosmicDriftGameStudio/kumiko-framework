// fw#2839: the type half of the fail-closed currency-source gate. This PR
// ships the break in one release instead of the #2810 warn-then-throw ladder,
// on the premise that a consumer sees it from the COMPILER at bump time, not
// only from a boot error in production. These `@ts-expect-error`s are that
// premise: each turns into a test failure the moment the narrowing stops
// catching an undeclared money field in one of the three forms an author
// writes a screen in.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ScreenDefinition,
  SecretMintScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";

const layout = { sections: [{ title: "Payment", fields: ["amount"] }] };

describe("money field on an entity-less form screen is a compile error without `currency`", () => {
  test("annotated as the ScreenDefinition union", () => {
    const screen: ScreenDefinition = {
      id: "pay",
      type: "actionForm",
      handler: "billing:write:pay",
      // @ts-expect-error — money needs a declared currency source on an
      // entity-less form; if this compiles, FormFieldDefinition stopped
      // narrowing and the break would only surface at boot.
      fields: { amount: { type: "money", required: true } },
      layout,
    };
    expect(screen.type).toBe("actionForm");
  });

  test("annotated as ActionFormScreenDefinition", () => {
    const screen: ActionFormScreenDefinition = {
      id: "pay",
      type: "actionForm",
      handler: "billing:write:pay",
      // @ts-expect-error — see above.
      fields: { amount: { type: "money", required: true } },
      layout,
    };
    expect(screen.id).toBe("pay");
  });

  test("contextually typed through an r.screen(...)-shaped parameter", () => {
    const register = (def: ScreenDefinition): string => def.id;
    expect(
      register({
        id: "pay",
        type: "actionForm",
        handler: "billing:write:pay",
        // @ts-expect-error — see above.
        fields: { amount: { type: "money", required: true } },
        layout,
      }),
    ).toBe("pay");
  });

  test("secretMint's own fields are narrowed the same way", () => {
    const screen: SecretMintScreenDefinition = {
      id: "mint",
      type: "secretMint",
      handler: "billing:write:mint",
      // @ts-expect-error — see above.
      fields: { amount: { type: "money", required: true } },
      layout,
      reveal: { fields: [{ field: "token", label: "Token" }] },
    };
    expect(screen.type).toBe("secretMint");
  });
});

describe("declared currency sources compile", () => {
  test("literal and tenant are both accepted", () => {
    const screen: ScreenDefinition = {
      id: "pay",
      type: "actionForm",
      handler: "billing:write:pay",
      fields: {
        amount: { type: "money", required: true, currency: { kind: "literal", code: "EUR" } },
        fee: { type: "money", currency: { kind: "tenant" } },
      },
      layout: { sections: [{ title: "Payment", fields: ["amount", "fee"] }] },
    };
    expect(Object.keys(screen.type === "actionForm" ? screen.fields : {})).toEqual([
      "amount",
      "fee",
    ]);
  });
});
