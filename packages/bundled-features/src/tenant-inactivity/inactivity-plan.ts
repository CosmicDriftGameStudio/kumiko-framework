import {
  addDurationSpec,
  type DurationSpec,
  type RetentionSpec,
} from "@cosmicdrift/kumiko-framework/compliance";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

type Instant = Temporal.Instant;

export type InactivityRule = {
  readonly after: RetentionSpec;
  // Lead times before the deadline, in any order.
  readonly warnings: readonly DurationSpec[];
};

export type InactivityState = {
  readonly firstSeenAt: Instant;
  readonly lastActivityAt: Instant | null;
  readonly lastExemptAt: Instant | null;
  readonly warningsSent: number;
  readonly lastWarnedAt: Instant | null;
  // Set when a deadline passed without all warnings out: the last warning is sent late and
  // the deletion request moves behind it.
  readonly postponedDueAt: Instant | null;
};

export type InactivityStep = "warning" | "destructionRequest";

export type InactivityPlan = {
  readonly step: InactivityStep;
  readonly at: Instant;
};

export type InactivityDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: "warn";
      readonly warningsSentAfter: number;
      readonly deadline: Instant;
      readonly postponedDueAt: Instant | null;
    }
  | { readonly kind: "destroy" };

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

export function addRetentionSpec(from: Instant, spec: RetentionSpec): Instant {
  if ("months" in spec) {
    return from.toZonedDateTimeISO("UTC").add({ months: spec.months }).toInstant();
  }
  if ("years" in spec) {
    return from.toZonedDateTimeISO("UTC").add({ years: spec.years }).toInstant();
  }
  return addDurationSpec(from, spec);
}

function leadMs(spec: DurationSpec): number {
  return addDurationSpec(EPOCH, spec).epochMilliseconds;
}

// Longest lead first, so index 0 is the earliest warning.
export function sortedWarnings(rule: InactivityRule): readonly DurationSpec[] {
  return [...rule.warnings].sort((a, b) => leadMs(b) - leadMs(a));
}

function laterOf(instants: readonly (Instant | null)[]): Instant | null {
  let latest: Instant | null = null;
  for (const instant of instants) {
    if (instant !== null && (latest === null || Temporal.Instant.compare(instant, latest) > 0)) {
      latest = instant;
    }
  }
  return latest;
}

export function activityBase(state: InactivityState): Instant {
  return (
    laterOf([state.firstSeenAt, state.lastActivityAt, state.lastExemptAt]) ?? state.firstSeenAt
  );
}

// Activity after the last warning starts a new cycle.
export function isNewCycle(state: InactivityState): boolean {
  return (
    state.warningsSent > 0 &&
    state.lastWarnedAt !== null &&
    Temporal.Instant.compare(activityBase(state), state.lastWarnedAt) > 0
  );
}

export function resetWarnings(state: InactivityState): InactivityState {
  return { ...state, warningsSent: 0, lastWarnedAt: null, postponedDueAt: null };
}

export function dueAt(state: InactivityState, rule: InactivityRule): Instant {
  const regular = addRetentionSpec(activityBase(state), rule.after);
  return laterOf([regular, state.postponedDueAt]) ?? regular;
}

// Expects a state that already went through the new-cycle reset.
export function planNextStep(state: InactivityState, rule: InactivityRule): InactivityPlan {
  const due = dueAt(state, rule);
  const warnings = sortedWarnings(rule);
  const nextWarning = warnings[state.warningsSent];
  if (nextWarning === undefined) return { step: "destructionRequest", at: due };
  const warnAt = Temporal.Instant.fromEpochMilliseconds(
    due.epochMilliseconds - leadMs(nextWarning),
  );
  return { step: "warning", at: warnAt };
}

// At most one warning per run: the latest one that is due. A deadline that passed with warnings
// missing sends the final warning late and moves the deletion request behind it.
export function decideInactivityAction(
  state: InactivityState,
  rule: InactivityRule,
  now: Instant,
): InactivityDecision {
  const due = dueAt(state, rule);
  const warnings = sortedWarnings(rule);
  const total = warnings.length;
  if (state.warningsSent >= total) {
    return Temporal.Instant.compare(now, due) >= 0 ? { kind: "destroy" } : { kind: "none" };
  }
  const finalLead = warnings[total - 1];
  if (finalLead !== undefined && Temporal.Instant.compare(now, due) >= 0) {
    const postponedDueAt = addDurationSpec(now, finalLead);
    return {
      kind: "warn",
      warningsSentAfter: total,
      deadline: postponedDueAt,
      postponedDueAt,
    };
  }
  let lastDue = -1;
  for (let index = state.warningsSent; index < total; index++) {
    const lead = warnings[index];
    if (lead !== undefined && now.epochMilliseconds >= due.epochMilliseconds - leadMs(lead)) {
      lastDue = index;
    }
  }
  if (lastDue < 0) return { kind: "none" };
  return { kind: "warn", warningsSentAfter: lastDue + 1, deadline: due, postponedDueAt: null };
}

// Raises lastActivityAt to the newest known activity; activity after the last warning starts a
// new cycle, which also drops a postponed deadline.
export function foldActivity(
  state: InactivityState,
  newest: Instant | null,
): { readonly state: InactivityState; readonly newCycle: boolean } {
  const lastActivityAt = laterOf([state.lastActivityAt, newest]);
  const raised: InactivityState = { ...state, lastActivityAt };
  if (!isNewCycle(raised)) return { state: raised, newCycle: false };
  return { state: resetWarnings(raised), newCycle: true };
}

export type InactivityOutlook = {
  readonly exempt: boolean;
  readonly lastActivityAt: Instant | null;
  readonly warningsSent: number;
  readonly nextStep: InactivityStep | null;
  readonly nextStepAt: Instant | null;
};

// Shared by the daily job and the state query so both name the same next step.
export function describeOutlook(
  state: InactivityState | null,
  rule: InactivityRule | null,
): InactivityOutlook {
  if (rule === null || state === null) {
    return {
      exempt: rule === null,
      lastActivityAt: state?.lastActivityAt ?? null,
      warningsSent: state?.warningsSent ?? 0,
      nextStep: null,
      nextStepAt: null,
    };
  }
  const plan = planNextStep(state, rule);
  return {
    exempt: false,
    lastActivityAt: state.lastActivityAt,
    warningsSent: state.warningsSent,
    nextStep: plan.step,
    nextStepAt: plan.at,
  };
}
