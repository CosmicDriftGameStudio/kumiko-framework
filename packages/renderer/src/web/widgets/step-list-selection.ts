export type StepSelectability =
  | { readonly kind: "selectable" }
  | { readonly kind: "missing-input"; readonly reason: string }
  | { readonly kind: "none" };

export type StepStatus = "done" | "open" | "locked" | "running" | "rejected" | "failed";

export type SelectionStep = {
  readonly id: string;
  readonly title: string;
  readonly status: StepStatus;
  readonly selectable?: StepSelectability;
  readonly dependsOn?: readonly string[];
};

export type StepSelectionState =
  | { readonly kind: "none" }
  | { readonly kind: "selectable"; readonly checked: boolean; readonly neededFor?: string }
  | { readonly kind: "missing-input"; readonly reason: string }
  | { readonly kind: "blocked"; readonly blockedBy: string };

export type StepSelectionSummary = {
  readonly states: ReadonlyMap<string, StepSelectionState>;
  /** Explicit plus pulled-in prerequisites, in list order. */
  readonly effectiveIds: readonly string[];
  readonly selectedCount: number;
  readonly missingInputCount: number;
  readonly allState: "none" | "some" | "all";
  readonly hasSelectableSteps: boolean;
};

function isSelectableStatus(step: SelectionStep): boolean {
  return step.status === "open" || step.status === "locked";
}

function baseSelectability(step: SelectionStep): StepSelectability {
  if (!isSelectableStatus(step)) return { kind: "none" };
  return step.selectable ?? { kind: "selectable" };
}

function indexById(steps: readonly SelectionStep[]): ReadonlyMap<string, SelectionStep> {
  return new Map(steps.map((step) => [step.id, step]));
}

/** Title of the first prerequisite (transitively, skipping done ones) that cannot be selected itself. */
function findBlockingPrerequisite(
  step: SelectionStep,
  byId: ReadonlyMap<string, SelectionStep>,
): string | undefined {
  const visited = new Set<string>([step.id]);
  const walk = (current: SelectionStep): string | undefined => {
    for (const dependencyId of current.dependsOn ?? []) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined || dependency.status === "done" || visited.has(dependencyId)) {
        continue;
      }
      visited.add(dependencyId);
      if (baseSelectability(dependency).kind !== "selectable") return dependency.title;
      const nested = walk(dependency);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return walk(step);
}

/** Ids of all transitive prerequisites that still need work (done and unknown ones are skipped). */
function openPrerequisiteHull(
  step: SelectionStep,
  byId: ReadonlyMap<string, SelectionStep>,
): ReadonlySet<string> {
  const hull = new Set<string>();
  const walk = (current: SelectionStep): void => {
    for (const dependencyId of current.dependsOn ?? []) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined || dependency.status === "done" || hull.has(dependencyId)) {
        continue;
      }
      hull.add(dependencyId);
      walk(dependency);
    }
  };
  walk(step);
  hull.delete(step.id);
  return hull;
}

function isEffectivelySelectable(
  step: SelectionStep,
  byId: ReadonlyMap<string, SelectionStep>,
): boolean {
  return (
    baseSelectability(step).kind === "selectable" &&
    findBlockingPrerequisite(step, byId) === undefined
  );
}

export function resolveStepSelection(
  steps: readonly SelectionStep[],
  selectedIds: readonly string[],
): StepSelectionSummary {
  const byId = indexById(steps);
  const explicit = new Set(selectedIds);
  const explicitSteps = steps.filter(
    (step) => explicit.has(step.id) && isEffectivelySelectable(step, byId),
  );
  const hulls = new Map(explicitSteps.map((step) => [step.id, openPrerequisiteHull(step, byId)]));

  const effective = new Set<string>(explicitSteps.map((step) => step.id));
  for (const hull of hulls.values()) {
    for (const id of hull) effective.add(id);
  }
  const explicitEffective = new Set(explicitSteps.map((step) => step.id));

  const states = new Map<string, StepSelectionState>();
  let missingInputCount = 0;
  for (const step of steps) {
    const base = baseSelectability(step);
    if (base.kind === "none") {
      states.set(step.id, { kind: "none" });
      continue;
    }
    if (base.kind === "missing-input") {
      missingInputCount += 1;
      states.set(step.id, { kind: "missing-input", reason: base.reason });
      continue;
    }
    const blockedBy = findBlockingPrerequisite(step, byId);
    if (blockedBy !== undefined) {
      states.set(step.id, { kind: "blocked", blockedBy });
      continue;
    }
    const checked = effective.has(step.id);
    const neededForStep =
      checked && !explicitEffective.has(step.id)
        ? explicitSteps.find((candidate) => hulls.get(candidate.id)?.has(step.id) === true)
        : undefined;
    states.set(
      step.id,
      neededForStep === undefined
        ? { kind: "selectable", checked }
        : { kind: "selectable", checked, neededFor: neededForStep.title },
    );
  }

  const effectiveIds = steps.filter((step) => effective.has(step.id)).map((step) => step.id);
  const selectable = steps.filter((step) => states.get(step.id)?.kind === "selectable");
  const checkedSelectable = selectable.filter((step) => effective.has(step.id));
  const allState =
    checkedSelectable.length === 0
      ? "none"
      : checkedSelectable.length === selectable.length
        ? "all"
        : "some";

  return {
    states,
    effectiveIds,
    selectedCount: effectiveIds.length,
    missingInputCount,
    allState,
    hasSelectableSteps: selectable.length > 0,
  };
}

/** New explicit selection after toggling one step; unselecting also drops explicit dependents. */
export function toggleStepSelection(
  steps: readonly SelectionStep[],
  selectedIds: readonly string[],
  stepId: string,
): readonly string[] {
  const summary = resolveStepSelection(steps, selectedIds);
  const state = summary.states.get(stepId);
  if (state === undefined || state.kind !== "selectable") return selectedIds;
  const byId = indexById(steps);
  const explicit = new Set(selectedIds);
  if (state.checked) {
    for (const step of steps) {
      if (step.id === stepId || openPrerequisiteHull(step, byId).has(stepId)) {
        explicit.delete(step.id);
      }
    }
  } else {
    explicit.add(stepId);
  }
  return steps.filter((step) => explicit.has(step.id)).map((step) => step.id);
}

export function toggleAllStepSelection(
  steps: readonly SelectionStep[],
  selectedIds: readonly string[],
): readonly string[] {
  const summary = resolveStepSelection(steps, selectedIds);
  if (!summary.hasSelectableSteps || summary.allState === "all") return [];
  return steps
    .filter((step) => summary.states.get(step.id)?.kind === "selectable")
    .map((step) => step.id);
}
