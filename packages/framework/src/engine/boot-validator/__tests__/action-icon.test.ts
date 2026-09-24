// validateActionHasIcon is the single icon-resolvability check shared by
// every projectionDetail/entityEdit action rendered in a Card title row:
// screen-level `actions`, section-level `actions`, and relatedList
// `emptyState.action` (see screens.ts call sites). Tested directly here
// rather than only via a full feature boot, since all three call sites
// share this one function.

import { describe, expect, test } from "bun:test";
import { validateActionHasIcon } from "../screens";

describe("validateActionHasIcon", () => {
  test("rejects a screen-level action with no declared icon and an id that resolves none", () => {
    expect(() =>
      validateActionHasIcon("orders", "order-detail", "projectionDetail", "action", {
        id: "custom-thing",
      }),
    ).toThrow(/no resolvable icon/);
  });

  test("rejects a section action, naming the section in the error", () => {
    expect(() =>
      validateActionHasIcon(
        "orders",
        "order-detail",
        "projectionDetail",
        'section "Payments" action',
        { id: "custom-thing" },
      ),
    ).toThrow(/section "Payments" action "custom-thing" has no resolvable icon/);
  });

  test("rejects a relatedList emptyState action, naming it as such in the error", () => {
    expect(() =>
      validateActionHasIcon(
        "orders",
        "order-detail",
        "projectionDetail",
        'section "Payments" emptyState action',
        { id: "custom-thing" },
      ),
    ).toThrow(/emptyState action "custom-thing" has no resolvable icon/);
  });

  test("passes when the action declares an explicit icon", () => {
    expect(() =>
      validateActionHasIcon("orders", "order-detail", "entityEdit", "action", {
        id: "custom-thing",
        icon: "lock",
      }),
    ).not.toThrow();
  });

  test("passes when the id resolves a default icon via a kebab segment (no explicit icon needed)", () => {
    // "deletion" -> "trash" in the shared ACTION_ICON_BY_ID map.
    expect(() =>
      validateActionHasIcon("user-data-rights", "privacy-center", "projectionDetail", "action", {
        id: "request-deletion",
      }),
    ).not.toThrow();
  });

  // action.icon is typed IconKey (a closed union) — but that compile-time
  // guarantee only covers call sites inside this repo's `tsc --build`
  // project graph. Samples and external consumers aren't in it, so an
  // unregistered literal (a typo, or a value copied from a different icon
  // set) can reach here as plain runtime data. The renderer's actionIconFor
  // (renderer-web/src/primitives/index.tsx) already falls back to "no icon"
  // for such a value instead of crashing — this must throw here instead of
  // silently accepting it, or the renderer/validator resolvers diverge.
  test("rejects a declared icon that is not a registered NAV_ICON key, even though it resolves to a value", () => {
    expect(() =>
      validateActionHasIcon("orders", "order-detail", "projectionDetail", "action", {
        id: "refresh-order",
        // @ts-expect-error — exercising a value outside the closed IconKey
        // union, exactly like an untypechecked caller (a sample, or a JS
        // consumer) would produce at runtime.
        icon: "refresh-cw",
      }),
    ).toThrow(/no resolvable icon/);
  });
});
