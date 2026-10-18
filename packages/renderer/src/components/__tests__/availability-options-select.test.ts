import { describe, expect, test } from "bun:test";
import {
  filterUnavailableOptions,
  mergeOptionAvailability,
} from "../availability-options-select.tsx";

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

describe("filterUnavailableOptions", () => {
  test("drops options whose row is disabled, keeps the rest", () => {
    const filtered = filterUnavailableOptions(
      OPTIONS,
      [
        { value: "pro", disabled: true, hint: "ignored" },
        { value: "max", disabled: false },
      ],
      new Set(),
    );
    expect(filtered.map((option) => option.value)).toEqual(["free", "max"]);
  });

  test("a value held at mount stays listed but disabled", () => {
    const filtered = filterUnavailableOptions(
      OPTIONS,
      [{ value: "pro", disabled: true }],
      new Set(["pro"]),
    );
    expect(filtered.map((option) => option.value)).toEqual(["free", "pro", "max"]);
    expect(filtered.find((option) => option.value === "pro")?.disabled).toBe(true);
    expect(filtered.find((option) => option.value === "free")?.disabled).toBeUndefined();
  });

  test("unknown values, malformed rows and no rows leave every option", () => {
    expect(
      filterUnavailableOptions(
        OPTIONS,
        [
          { value: "ghost", disabled: true },
          { disabled: true },
          null,
          { value: "pro", disabled: "yes" },
        ],
        new Set(),
      ),
    ).toEqual([...OPTIONS]);
    expect(filterUnavailableOptions(OPTIONS, [], new Set())).toEqual([...OPTIONS]);
  });
});
