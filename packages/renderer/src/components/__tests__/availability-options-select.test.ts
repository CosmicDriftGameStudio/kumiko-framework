import { describe, expect, test } from "bun:test";
import { mergeOptionAvailability } from "../availability-options-select.js";

const OPTIONS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "max", label: "Max" },
] as const;

describe("mergeOptionAvailability", () => {
  test("disabled and hint land on the matching option, the others stay untouched", () => {
    const merged = mergeOptionAvailability(
      OPTIONS,
      [{ value: "pro", disabled: true, hint: "ab Starter" }, { value: "max" }],
      "free",
    );
    expect(merged).toEqual([
      { value: "free", label: "Free" },
      { value: "pro", label: "Pro", description: "ab Starter", disabled: true },
      { value: "max", label: "Max" },
    ]);
  });

  test("the stored value is never disabled but keeps its hint", () => {
    const merged = mergeOptionAvailability(
      OPTIONS,
      [{ value: "pro", disabled: true, hint: "ab Starter" }],
      "pro",
    );
    expect(merged[1]).toEqual({ value: "pro", label: "Pro", description: "ab Starter" });
  });

  test("unknown values and malformed rows are ignored", () => {
    const merged = mergeOptionAvailability(
      OPTIONS,
      [
        { value: "ghost", disabled: true, hint: "nope" },
        { disabled: true },
        null,
        "pro",
        { value: "pro", disabled: "yes" },
        { value: "max", hint: 3 },
      ],
      "",
    );
    expect(merged).toEqual([...OPTIONS]);
  });

  test("no rows leaves every option choosable", () => {
    expect(mergeOptionAvailability(OPTIONS, [], "free")).toEqual([...OPTIONS]);
  });
});
