import { describe, expect, test } from "bun:test";
import {
  resolveStepSelection,
  type SelectionStep,
  toggleAllStepSelection,
  toggleStepSelection,
} from "../step-list-selection.ts";

const chain: readonly SelectionStep[] = [
  { id: "case", title: "Vorgang", status: "done" },
  { id: "order", title: "Auftrag", status: "open", dependsOn: ["case"] },
  { id: "reply", title: "Antwort", status: "locked", dependsOn: ["order"] },
  { id: "invoice", title: "Rechnung", status: "open", dependsOn: ["reply"] },
];

describe("resolveStepSelection", () => {
  test("pulls in transitive open prerequisites and skips done ones", () => {
    const summary = resolveStepSelection(chain, ["invoice"]);
    expect(summary.effectiveIds).toEqual(["order", "reply", "invoice"]);
    expect(summary.selectedCount).toBe(3);
    expect(summary.states.get("case")).toEqual({ kind: "none" });
  });

  test("names the first explicit step a pulled-in prerequisite is needed for", () => {
    const summary = resolveStepSelection(chain, ["invoice", "reply"]);
    expect(summary.states.get("order")).toEqual({
      kind: "selectable",
      checked: true,
      neededFor: "Antwort",
    });
    expect(summary.states.get("reply")).toEqual({ kind: "selectable", checked: true });
  });

  test("survives dependency cycles", () => {
    const cyclic: readonly SelectionStep[] = [
      { id: "a", title: "A", status: "open", dependsOn: ["b"] },
      { id: "b", title: "B", status: "open", dependsOn: ["a"] },
      { id: "self", title: "Self", status: "open", dependsOn: ["self"] },
    ];
    expect(resolveStepSelection(cyclic, ["a"]).effectiveIds).toEqual(["a", "b"]);
    expect(resolveStepSelection(cyclic, ["self"]).effectiveIds).toEqual(["self"]);
  });

  test("a prerequisite that cannot be selected blocks its dependents", () => {
    const steps: readonly SelectionStep[] = [
      { id: "pay", title: "Zahlung", status: "open", selectable: { kind: "none" } },
      { id: "mail", title: "Mail", status: "open", dependsOn: ["pay"] },
      { id: "late", title: "Spät", status: "open", dependsOn: ["mail"] },
    ];
    const summary = resolveStepSelection(steps, ["mail", "late"]);
    expect(summary.states.get("mail")).toEqual({ kind: "blocked", blockedBy: "Zahlung" });
    expect(summary.states.get("late")).toEqual({ kind: "blocked", blockedBy: "Zahlung" });
    expect(summary.effectiveIds).toEqual([]);
  });

  test("a rejected prerequisite blocks, an unknown id is ignored", () => {
    const steps: readonly SelectionStep[] = [
      { id: "old", title: "Alt", status: "rejected" },
      { id: "x", title: "X", status: "open", dependsOn: ["old"] },
      { id: "y", title: "Y", status: "open", dependsOn: ["ghost"] },
    ];
    const summary = resolveStepSelection(steps, ["x", "y"]);
    expect(summary.states.get("x")?.kind).toBe("blocked");
    expect(summary.effectiveIds).toEqual(["y"]);
  });

  test("counts steps waiting for input", () => {
    const steps: readonly SelectionStep[] = [
      {
        id: "a",
        title: "A",
        status: "open",
        selectable: { kind: "missing-input", reason: "IBAN" },
      },
      { id: "b", title: "B", status: "open" },
    ];
    const summary = resolveStepSelection(steps, []);
    expect(summary.missingInputCount).toBe(1);
    expect(summary.states.get("a")).toEqual({ kind: "missing-input", reason: "IBAN" });
  });

  test("only open and locked steps are selectable", () => {
    const steps: readonly SelectionStep[] = [
      { id: "r", title: "R", status: "running" },
      { id: "f", title: "F", status: "failed" },
    ];
    expect(resolveStepSelection(steps, ["r", "f"]).effectiveIds).toEqual([]);
    expect(resolveStepSelection(steps, []).hasSelectableSteps).toBe(false);
  });
});

describe("toggleStepSelection", () => {
  test("adds an unselected step and keeps list order", () => {
    expect(toggleStepSelection(chain, ["order"], "invoice")).toEqual(["order", "invoice"]);
    expect(toggleStepSelection(chain, [], "reply")).toEqual(["reply"]);
  });

  test("unselecting a pulled-in prerequisite drops the steps that depend on it", () => {
    expect(toggleStepSelection(chain, ["reply", "invoice"], "order")).toEqual([]);
  });

  test("unselecting an explicit step leaves unrelated ones", () => {
    expect(toggleStepSelection(chain, ["order", "reply"], "reply")).toEqual(["order"]);
  });

  test("blocked and none steps do not change the selection", () => {
    const steps: readonly SelectionStep[] = [
      { id: "pay", title: "Zahlung", status: "open", selectable: { kind: "none" } },
      { id: "mail", title: "Mail", status: "open", dependsOn: ["pay"] },
    ];
    expect(toggleStepSelection(steps, [], "pay")).toEqual([]);
    expect(toggleStepSelection(steps, [], "mail")).toEqual([]);
  });
});

describe("toggleAllStepSelection", () => {
  test("selects every selectable step, then clears", () => {
    const all = toggleAllStepSelection(chain, []);
    expect(all).toEqual(["order", "reply", "invoice"]);
    expect(resolveStepSelection(chain, all).allState).toBe("all");
    expect(toggleAllStepSelection(chain, all)).toEqual([]);
  });

  test("a partial selection is completed", () => {
    expect(resolveStepSelection(chain, ["order"]).allState).toBe("some");
    expect(toggleAllStepSelection(chain, ["order"])).toEqual(["order", "reply", "invoice"]);
  });

  test("a prerequisite pulled in counts as selected for the all state", () => {
    expect(resolveStepSelection(chain, ["invoice"]).allState).toBe("all");
  });
});
