// setupTestStack checks nav references on the mounted features and, on request, runs the full prod validateBoot.
import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/define-feature.js";
import { setupTestStack } from "../test-stack.js";

const openToAllAccess = {
  access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
};

const brokenNavInMountedFeature = defineFeature("navbroken", (r) => {
  r.nav({ id: "home", label: "navbroken:nav.home", screen: "navbroken:screen:missing" });
});

const navToUnmountedFeature = defineFeature("navsubset", (r) => {
  r.nav({ id: "home", label: "navsubset:nav.home", screen: "elsewhere:screen:dashboard" });
});

const refEntityToUnmountedFeature = defineFeature("ledger", (r) => {
  r.queryHandler(
    "schedule:list",
    z.object({}),
    async () => ({ rows: [], nextCursor: null }),
    openToAllAccess,
  );
  r.screen({
    id: "schedule-list",
    type: "projectionList",
    query: "ledger:query:schedule:list",
    columns: [{ field: "ownerId", refEntity: "owners:owner" }],
  });
});

describe("setupTestStack boot validation", () => {
  test("subset check rejects a nav screen ref that is missing inside a mounted feature", async () => {
    await expect(setupTestStack({ features: [brokenNavInMountedFeature] })).rejects.toThrow(
      /Nav entry "home" references screen "navbroken:screen:missing"/,
    );
  });

  test("subset check ignores a ref into a feature that is not mounted", async () => {
    const stack = await setupTestStack({ features: [navToUnmountedFeature] });
    expect(stack.registry.features.has("navsubset")).toBe(true);
    await stack.cleanup();
  });

  test("full mode catches a refEntity into an unmounted feature that the subset lets through", async () => {
    const subset = await setupTestStack({ features: [refEntityToUnmountedFeature] });
    await subset.cleanup();

    await expect(
      setupTestStack({ features: [refEntityToUnmountedFeature], validateBoot: "full" }),
    ).rejects.toThrow(/column "ownerId" \(refEntity\)/);
  });
});
