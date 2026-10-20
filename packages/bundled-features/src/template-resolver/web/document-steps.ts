// A progress row: fixed stages stored in the template, the reached stage read
// from a variable at render time. Universal like document-schema.ts.
import { Node } from "@tiptap/core";

// Keys end up as Handlebars string literals in the compiled body, so they are
// restricted to characters that cannot close or escape a literal.
const STEP_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
export const DOCUMENT_STEPS_MAX = 8;
const STEP_LABEL_MAX_LENGTH = 40;

export type DocumentStep = { readonly key: string; readonly label: string };

export function isDocumentStepKey(value: string): boolean {
  return STEP_KEY.test(value);
}

export function documentStepKeyOf(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Editor input: "value=Label" entries separated by commas; a bare label derives its value.
export function parseDocumentStepsInput(text: string): readonly DocumentStep[] | null {
  const steps = text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry): DocumentStep => {
      const separator = entry.indexOf("=");
      const label = (separator < 0 ? entry : entry.slice(separator + 1)).trim();
      const key = separator < 0 ? documentStepKeyOf(entry) : entry.slice(0, separator).trim();
      return { key, label: label.slice(0, STEP_LABEL_MAX_LENGTH) };
    });
  return areValidSteps(steps) ? steps : null;
}

function areValidSteps(steps: readonly DocumentStep[]): boolean {
  return (
    steps.length > 0 &&
    steps.length <= DOCUMENT_STEPS_MAX &&
    new Set(steps.map((step) => step.key)).size === steps.length &&
    steps.every((step) => isDocumentStepKey(step.key) && step.label !== "")
  );
}

// Duplicate or invalid keys would make the reached stage ambiguous, so the whole
// list is refused rather than repaired.
export function readDocumentSteps(element: {
  querySelectorAll(selector: string): ArrayLike<{
    getAttribute(name: string): string | null;
    textContent: string | null;
  }>;
}): readonly DocumentStep[] | null {
  const steps = Array.from(element.querySelectorAll("span[data-step]")).map((span) => ({
    key: span.getAttribute("data-step") ?? "",
    label: (span.textContent ?? "").trim().slice(0, STEP_LABEL_MAX_LENGTH),
  }));
  return areValidSteps(steps) ? steps : null;
}

function isDocumentStep(step: unknown): step is DocumentStep {
  return (
    typeof step === "object" &&
    step !== null &&
    "key" in step &&
    "label" in step &&
    typeof step.key === "string" &&
    typeof step.label === "string"
  );
}

// Node attrs are untyped JSON; anything that is not a step entry is dropped.
export function readDocumentStepsAttribute(value: unknown): readonly DocumentStep[] {
  return Array.isArray(value) ? value.filter(isDocumentStep) : [];
}

export function createDocumentStepsNode(isReferenceName: (value: string) => boolean) {
  return Node.create({
    name: "steps",
    group: "block",
    atom: true,
    addAttributes() {
      return { variable: { default: null }, steps: { default: [] } };
    },
    parseHTML() {
      return [
        {
          tag: "div[data-steps]",
          getAttrs: (element) => {
            const variable = element.getAttribute("data-steps");
            const steps = readDocumentSteps(element);
            if (variable === null || !isReferenceName(variable) || steps === null) return false;
            return { variable, steps };
          },
        },
      ];
    },
    renderHTML({ node }) {
      return [
        "div",
        { "data-steps": node.attrs["variable"] },
        ...readDocumentStepsAttribute(node.attrs["steps"]).map(
          (step) => ["span", { "data-step": step.key }, step.label] as const,
        ),
      ];
    },
  });
}
