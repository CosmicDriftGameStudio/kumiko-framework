import { describe, expect, test } from "bun:test";
import { declareEscapeHatch } from "../escape-hatch-declaration.ts";
import { CODEMOD_PLACEHOLDER_REASON_MARKER, reasonProblem } from "../escape-hatch-reason.ts";

describe("reasonProblem", () => {
  test.each([
    "",
    "   ",
    "todo",
    "TODO",
    "Legacy.",
    "n/a",
    "-",
    "todo: fix later",
    "FIXME: revisit",
    "tbd: decide later",
    `lists rows (${CODEMOD_PLACEHOLDER_REASON_MARKER})`,
  ])("%p is rejected", (reason) => {
    expect(reasonProblem(reason)).toBeString();
  });

  test.each([
    "cross-tenant job monitoring",
    "SystemAdmin lists tenants platform-wide",
    "legacy import of tenant rows from the old billing system",
  ])("%p is accepted", (reason) => {
    expect(reasonProblem(reason)).toBeUndefined();
  });
});

describe("declareEscapeHatch", () => {
  test("accepts a real reason", () => {
    expect(() => declareEscapeHatch({ reason: "archives tenant rows on destroy" })).not.toThrow();
  });

  test("throws on a placeholder reason, naming the call", () => {
    expect(() => declareEscapeHatch({ reason: "todo" })).toThrow(/declareEscapeHatch.*placeholder/);
  });

  test("throws on an empty reason", () => {
    expect(() => declareEscapeHatch({ reason: "  " })).toThrow(/declareEscapeHatch.*non-empty/);
  });
});
