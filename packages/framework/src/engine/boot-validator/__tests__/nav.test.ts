import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { NavDefinition } from "../../types";
import { warnOnUnreachableNavScreens } from "../nav";

function navMap(
  entries: ReadonlyArray<[string, NavDefinition & { readonly featureName: string }]>,
): Map<string, NavDefinition & { readonly featureName: string }> {
  return new Map(entries);
}

describe("warnOnUnreachableNavScreens", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("does not warn for an unallowlisted nav whose screen is reached by an allowlisted nav", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:b",
        {
          id: "b",
          label: "B",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(allNavQns, new Set(["vehicles:nav:a"]));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("warns only for the unallowlisted nav whose screen nobody else reaches", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:b",
        {
          id: "b",
          label: "B",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:c",
        {
          id: "c",
          label: "C",
          screen: "vehicles:screen:title",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(allNavQns, new Set(["vehicles:nav:a"]));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("vehicles:nav:c");
    expect(msg).toContain("vehicles");
    expect(msg).toContain("vehicles:screen:title");
  });

  test("navAllowlistExempt suppresses the warning for an exempted nav", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:c",
        {
          id: "c",
          label: "C",
          screen: "vehicles:screen:title",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(
      allNavQns,
      new Set(["vehicles:nav:a"]),
      new Set(["vehicles:nav:c"]),
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("never warns for a nav without a screen (pure grouping entry)", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:group",
        {
          id: "group",
          label: "Group",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(allNavQns, new Set());

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
