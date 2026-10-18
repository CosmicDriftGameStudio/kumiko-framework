import { describe, expect, test } from "bun:test";
import type { EditFieldSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { applyEditPrefill, todayInTimeZone } from "../edit-prefill.ts";

type Spec = Exclude<EditFieldSpec, string>;

const user = { id: "u1", email: "ines@example.com", displayName: "Ines Prüfer" };
const specs: readonly Spec[] = [
  { field: "date", prefill: { kind: "today" } },
  { field: "inspector", prefill: { kind: "currentUser", property: "displayName" } },
  { field: "inspectorId", prefill: { kind: "currentUser", property: "id" } },
  { field: "contact", prefill: { kind: "currentUser", property: "email" } },
  { field: "plain" },
];

describe("todayInTimeZone", () => {
  test("23:30 UTC is already the next day in Europe/Berlin", () => {
    const now = new Date("2026-03-10T23:30:00Z");
    expect(todayInTimeZone(now, "UTC")).toBe("2026-03-10");
    expect(todayInTimeZone(now, "Europe/Berlin")).toBe("2026-03-11");
  });

  test("00:30 UTC is still the previous day in America/New_York", () => {
    expect(todayInTimeZone(new Date("2026-03-10T00:30:00Z"), "America/New_York")).toBe(
      "2026-03-09",
    );
  });
});

describe("applyEditPrefill", () => {
  const now = new Date("2026-03-10T23:30:00Z");
  const empty = { date: "", inspector: "", inspectorId: "", contact: "", plain: "" };

  test("fills empty values from the clock and the current user", () => {
    const out = applyEditPrefill(empty, specs, {
      now,
      fallbackTimeZone: "UTC",
      user: { ...user, timeZone: "Europe/Berlin" },
    });
    expect(out).toEqual({
      date: "2026-03-11",
      inspector: "Ines Prüfer",
      inspectorId: "u1",
      contact: "ines@example.com",
      plain: "",
    });
  });

  test("the user's zone wins over the fallback, the fallback applies without one", () => {
    const withoutZone = applyEditPrefill(empty, specs, {
      now,
      fallbackTimeZone: "Europe/Berlin",
      user,
    });
    expect(withoutZone["date"]).toBe("2026-03-11");
    const anonymous = applyEditPrefill(empty, specs, {
      now,
      fallbackTimeZone: "UTC",
      user: undefined,
    });
    expect(anonymous["date"]).toBe("2026-03-10");
    expect(anonymous["inspector"]).toBe("");
  });

  test("never overwrites an existing value", () => {
    const filled = { ...empty, date: "2020-01-02", inspector: "Someone else" };
    const out = applyEditPrefill(filled, specs, { now, fallbackTimeZone: "UTC", user });
    expect(out["date"]).toBe("2020-01-02");
    expect(out["inspector"]).toBe("Someone else");
    expect(out["inspectorId"]).toBe("u1");
  });
});
