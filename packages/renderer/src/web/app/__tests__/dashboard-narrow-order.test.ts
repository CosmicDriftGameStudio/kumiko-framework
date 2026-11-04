import { describe, expect, test } from "bun:test";
import type { DashboardPanelDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { panelsInNarrowOrder } from "../dashboard-narrow-order.ts";

const panel = (id: string, narrowOrder?: number) =>
  ({
    kind: "text",
    id,
    ...(narrowOrder !== undefined && { narrowOrder }),
  }) as DashboardPanelDefinition;

describe("panelsInNarrowOrder", () => {
  const panels = [panel("a", 2), panel("b"), panel("c", 1), panel("d")];

  test("desktop keeps the declared order", () => {
    expect(panelsInNarrowOrder(panels, false).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("below sm sorts by narrowOrder, equal values keep the declared order", () => {
    expect(panelsInNarrowOrder(panels, true).map((p) => p.id)).toEqual(["b", "d", "c", "a"]);
  });
});
