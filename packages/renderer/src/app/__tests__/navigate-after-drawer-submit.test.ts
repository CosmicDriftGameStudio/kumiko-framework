import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema, NavTarget } from "../../index.ts";
import type { NavApi } from "../nav.tsx";
import { navigateAfterDrawerSubmit } from "../screen-shared.tsx";

const detailScreen = {
  id: "order-detail",
  type: "projectionDetail",
  query: "orders:query:order:detail",
  fields: ["title"],
} as unknown as ProjectionDetailScreenDefinition;

const schema = { screens: [detailScreen] } as unknown as FeatureSchema;

function run(routeEntityId: string): NavTarget[] {
  const calls: NavTarget[] = [];
  const nav = {
    route: { screenId: "order-detail", entityId: routeEntityId },
    navigate: (target: NavTarget) => {
      calls.push(target);
    },
  } as unknown as NavApi;
  navigateAfterDrawerSubmit({
    nav,
    schema,
    appFeatures: [schema],
    redirect: { screen: "order-detail", idFrom: "id" },
    resultData: { id: "order-1" },
  });
  return calls;
}

describe("navigateAfterDrawerSubmit", () => {
  test("a redirect onto the open record of the host projectionDetail does not navigate", () => {
    expect(run("order-1")).toEqual([]);
  });

  test("a redirect onto another record of the same screen navigates", () => {
    expect(run("order-2")).toEqual([{ screenId: "order-detail", entityId: "order-1" }]);
  });
});
