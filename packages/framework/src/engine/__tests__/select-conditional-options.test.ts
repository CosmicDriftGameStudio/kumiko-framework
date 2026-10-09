import { describe, expect, test } from "bun:test";
import { createEntity, createSelectField } from "../factories.js";
import { availableSelectOptions, findUnavailableSelectOptions } from "../screen-helpers.js";

const interval = createSelectField({
  options: ["60", "300", "3600"],
  default: "300",
  conditionalOptions: [{ options: ["3600"], when: { field: "kind", eq: "heartbeat" } }],
});
const kind = createSelectField({ options: ["http", "heartbeat"], default: "http" });
const { fields } = createEntity({ table: "monitors", fields: { kind, interval } });

describe("availableSelectOptions", () => {
  test("hides a conditional option while its condition does not hold", () => {
    expect(availableSelectOptions(interval, { kind: "http" })).toEqual(["60", "300"]);
  });

  test("offers the conditional option in declaration order when the condition holds", () => {
    expect(availableSelectOptions(interval, { kind: "heartbeat" })).toEqual(["60", "300", "3600"]);
  });

  test("a field without conditionalOptions offers every option", () => {
    expect(availableSelectOptions(kind, {})).toEqual(["http", "heartbeat"]);
  });
});

describe("findUnavailableSelectOptions", () => {
  test("flags an unavailable value on create", () => {
    expect(findUnavailableSelectOptions(fields, { kind: "http", interval: "3600" })).toEqual([
      { field: "interval", value: "3600", allowed: ["60", "300"] },
    ]);
  });

  test("accepts an available value on create", () => {
    expect(findUnavailableSelectOptions(fields, { kind: "heartbeat", interval: "3600" })).toEqual(
      [],
    );
  });

  test("ignores empty and non-string values", () => {
    expect(findUnavailableSelectOptions(fields, { kind: "http", interval: "" })).toEqual([]);
    expect(findUnavailableSelectOptions(fields, { kind: "http", interval: null })).toEqual([]);
    expect(findUnavailableSelectOptions(fields, { kind: "http" })).toEqual([]);
  });

  const legacyRow = { kind: "http", interval: "3600", name: "old" };

  test("update skips a legacy row when neither the field nor its condition field changed", () => {
    expect(findUnavailableSelectOptions(fields, { ...legacyRow, name: "new" }, legacyRow)).toEqual(
      [],
    );
  });

  test("update flags when only the condition field changed", () => {
    const previous = { kind: "heartbeat", interval: "3600" };
    expect(findUnavailableSelectOptions(fields, { ...previous, kind: "http" }, previous)).toEqual([
      { field: "interval", value: "3600", allowed: ["60", "300"] },
    ]);
  });

  test("update flags when only the field changed", () => {
    const previous = { kind: "http", interval: "60" };
    expect(
      findUnavailableSelectOptions(fields, { ...previous, interval: "3600" }, previous),
    ).toEqual([{ field: "interval", value: "3600", allowed: ["60", "300"] }]);
  });
});
