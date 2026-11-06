import type {
  ProjectionDetailScreenDefinition,
  RecordBreadcrumbItem,
  RecordNotice,
  RecordProgress,
  RecordStep,
  SelectOptionTone,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { isSelectOptionTone } from "../status-tone.ts";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function readTone(value: unknown): SelectOptionTone | undefined {
  return isSelectOptionTone(value) ? value : undefined;
}

export function readBreadcrumbItems(value: unknown): RecordBreadcrumbItem[] {
  if (!Array.isArray(value)) return [];
  const items: RecordBreadcrumbItem[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw) || typeof raw["label"] !== "string" || raw["label"] === "") continue;
    const entity = optionalString(raw["entity"]);
    const id = optionalString(raw["id"]);
    items.push({
      label: raw["label"],
      ...(entity !== undefined && { entity }),
      ...(id !== undefined && { id }),
    });
  }
  return items;
}

export function readNotice(value: unknown): RecordNotice | undefined {
  if (!isPlainObject(value)) return undefined;
  // Typed keys are re-added only when valid, so a malformed tone or text can't ride along in `rest`.
  // `rest` is only input for the banner actions' show/enabled predicates; it is never rendered.
  const { title, text, narrowTitle, narrowText, tone, ...rest } = value;
  if (typeof title !== "string" || title === "") return undefined;
  const parsedTone = readTone(tone);
  return {
    ...rest,
    title,
    ...(typeof text === "string" && { text }),
    ...(typeof narrowTitle === "string" && narrowTitle !== "" && { narrowTitle }),
    ...(typeof narrowText === "string" && narrowText !== "" && { narrowText }),
    ...(parsedTone !== undefined && { tone: parsedTone }),
  };
}

function readStepWhy(
  why: unknown,
  whyOpen: unknown,
  whyTitle: unknown,
): Pick<RecordStep, "why" | "whyOpen" | "whyTitle"> {
  return {
    ...(typeof why === "string" && why !== "" && { why }),
    ...(whyOpen === true && { whyOpen: true as const }),
    ...(typeof whyTitle === "string" && whyTitle !== "" && { whyTitle }),
  };
}

export function readSteps(value: unknown): RecordStep[] {
  if (!Array.isArray(value)) return [];
  const steps: RecordStep[] = [];
  const seenIds = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    // `rest` is only input for the step actions' show/enabled predicates; it is never rendered.
    const { id, title, detail, why, whyOpen, whyTitle, tone, ...rest } = raw;
    if (typeof id !== "string" || id === "" || typeof title !== "string" || title === "") {
      continue;
    }
    // The id is the React key and the test id; the first step of an id wins.
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const parsedTone = readTone(tone);
    steps.push({
      ...rest,
      id,
      title,
      ...(typeof detail === "string" && { detail }),
      ...readStepWhy(why, whyOpen, whyTitle),
      ...(parsedTone !== undefined && { tone: parsedTone }),
    });
  }
  return steps;
}

function isRecordProgress(value: unknown): value is RecordProgress {
  if (!isPlainObject(value)) return false;
  const { title, steps, currentIndex } = value;
  return (
    typeof title === "string" &&
    typeof currentIndex === "number" &&
    Number.isFinite(currentIndex) &&
    Array.isArray(steps) &&
    steps.every(
      (step) =>
        isPlainObject(step) &&
        typeof step["id"] === "string" &&
        typeof step["label"] === "string" &&
        typeof step["done"] === "boolean" &&
        (step["detail"] === undefined || typeof step["detail"] === "string"),
    )
  );
}

export function isRecordProgressArray(value: unknown): value is readonly RecordProgress[] {
  return Array.isArray(value) && value.every(isRecordProgress);
}

export function hasRecordGuidance(screen: ProjectionDetailScreenDefinition): boolean {
  return (
    screen.breadcrumb !== undefined ||
    screen.summary !== undefined ||
    screen.banner !== undefined ||
    screen.steps !== undefined ||
    screen.progress !== undefined
  );
}
