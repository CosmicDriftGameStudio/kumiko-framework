import { describe, expect, test } from "bun:test";
import { resolveSelectPresentation } from "../input-select-presentation.ts";

const shortOptions = [{ label: "Yes" }, { label: "No" }];
const manyOptions = ["a", "b", "c", "d", "e"].map((label) => ({ label }));
const describedOptions = [{ label: "Yes", description: "Confirms" }, { label: "No" }];
const groupedOptions = [{ label: "Yes", group: "Answers" }, { label: "No" }];

describe("resolveSelectPresentation", () => {
  test("a few short options default to a segmented control", () => {
    expect(resolveSelectPresentation({}, shortOptions)).toBe("segmented");
  });

  test("many options default to a dropdown", () => {
    expect(resolveSelectPresentation({}, manyOptions)).toBe("dropdown");
  });

  test("an explicit radio request outranks the option-count heuristic", () => {
    expect(resolveSelectPresentation({ display: "radio" }, manyOptions)).toBe("segmented");
  });

  test("an explicit dropdown request outranks the heuristic for short options", () => {
    expect(resolveSelectPresentation({ display: "dropdown" }, shortOptions)).toBe("dropdown");
  });

  test("the card variant forces the radio list, whatever display asks for", () => {
    expect(
      resolveSelectPresentation({ radioVariant: "card", display: "dropdown" }, shortOptions),
    ).toBe("radioList");
  });

  test("options with a description or group never render segmented", () => {
    expect(resolveSelectPresentation({}, describedOptions)).toBe("radioList");
    expect(resolveSelectPresentation({ display: "radio" }, groupedOptions)).toBe("radioList");
  });

  test("a dropdown request stays a dropdown for described options", () => {
    expect(resolveSelectPresentation({ display: "dropdown" }, describedOptions)).toBe("dropdown");
  });
});
