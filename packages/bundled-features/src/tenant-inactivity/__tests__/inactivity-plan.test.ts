import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  decideInactivityAction,
  describeOutlook,
  foldActivity,
  type InactivityRule,
  type InactivityState,
  planNextStep,
} from "../inactivity-plan.ts";

const RULE: InactivityRule = { after: { months: 12 }, warnings: [{ days: 30 }, { days: 7 }] };
const START = Temporal.Instant.from("2030-01-15T10:00:00Z");
const DUE = Temporal.Instant.from("2031-01-15T10:00:00Z");
const DAY_HOURS = 24;

function stateAt(overrides: Partial<InactivityState> = {}): InactivityState {
  return {
    firstSeenAt: START,
    lastActivityAt: null,
    lastExemptAt: null,
    warningsSent: 0,
    lastWarnedAt: null,
    postponedDueAt: null,
    ...overrides,
  };
}

const daysBeforeDue = (days: number) => DUE.subtract({ hours: days * DAY_HOURS });

describe("decideInactivityAction", () => {
  test("stays quiet before the first warning", () => {
    expect(decideInactivityAction(stateAt(), RULE, daysBeforeDue(31)).kind).toBe("none");
  });

  test("sends the first warning 30 days before the due date", () => {
    expect(decideInactivityAction(stateAt(), RULE, daysBeforeDue(30))).toMatchObject({
      kind: "warn",
      warningsSentAfter: 1,
      deadline: DUE,
    });
  });

  test("sends only the latest due warning after a missed run", () => {
    expect(decideInactivityAction(stateAt(), RULE, daysBeforeDue(3))).toMatchObject({
      kind: "warn",
      warningsSentAfter: 2,
    });
  });

  test("requests destruction only once every warning is out and the due date passed", () => {
    const warned = stateAt({ warningsSent: 2, lastWarnedAt: daysBeforeDue(7) });
    expect(decideInactivityAction(warned, RULE, daysBeforeDue(1)).kind).toBe("none");
    expect(decideInactivityAction(warned, RULE, DUE).kind).toBe("destroy");
  });

  test("a due date reached with warnings missing sends the last warning late and postpones", () => {
    const late = DUE.add({ hours: 5 * DAY_HOURS });
    const decision = decideInactivityAction(stateAt(), RULE, late);
    expect(decision).toMatchObject({ kind: "warn", warningsSentAfter: 2 });
    expect(decision.kind === "warn" ? decision.postponedDueAt : null).toEqual(
      late.add({ hours: 7 * DAY_HOURS }),
    );
  });
});

describe("foldActivity", () => {
  test("activity after the last warning starts a new cycle", () => {
    const warned = stateAt({ warningsSent: 1, lastWarnedAt: daysBeforeDue(30) });
    const activity = daysBeforeDue(20);
    const folded = foldActivity(warned, activity);
    expect(folded.newCycle).toBe(true);
    expect(folded.state).toMatchObject({ warningsSent: 0, lastWarnedAt: null });
    expect(folded.state.lastActivityAt).toEqual(activity);
  });

  test("activity before the last warning keeps the cycle", () => {
    const warned = stateAt({ warningsSent: 1, lastWarnedAt: daysBeforeDue(30) });
    expect(foldActivity(warned, START.add({ hours: 1 })).newCycle).toBe(false);
  });

  test("never moves lastActivityAt backwards", () => {
    const state = stateAt({ lastActivityAt: daysBeforeDue(40) });
    expect(foldActivity(state, START).state.lastActivityAt).toEqual(daysBeforeDue(40));
  });
});

describe("planNextStep and describeOutlook", () => {
  test("names the next warning, then the deletion request", () => {
    expect(planNextStep(stateAt(), RULE)).toEqual({ step: "warning", at: daysBeforeDue(30) });
    expect(planNextStep(stateAt({ warningsSent: 1 }), RULE)).toEqual({
      step: "warning",
      at: daysBeforeDue(7),
    });
    expect(planNextStep(stateAt({ warningsSent: 2 }), RULE)).toEqual({
      step: "destructionRequest",
      at: DUE,
    });
  });

  test("a tier without a rule is exempt with no next step", () => {
    expect(describeOutlook(stateAt(), null)).toMatchObject({ exempt: true, nextStep: null });
  });

  test("months are calendar months, not 30 days", () => {
    const fromEndOfMonth = stateAt({ firstSeenAt: Temporal.Instant.from("2030-01-31T00:00:00Z") });
    const plan = planNextStep(fromEndOfMonth, { after: { months: 1 }, warnings: [] });
    expect(plan.at.toString()).toBe("2030-02-28T00:00:00Z");
  });
});
