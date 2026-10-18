import type { Element as ScanElement } from "happy-dom";
import { isDocumentReferenceName } from "./document-schema.ts";
import { readDocumentSteps } from "./document-steps.ts";
import { isHexColor } from "./layout-appearance.ts";

export const DEFAULT_STEPS_COLOR = "#1f5468";
const TODO_BAR_COLOR = "#ECEDEA";
const REACHED_LABEL_COLOR = "#0B0D12";
const TODO_LABEL_COLOR = "#5A6170";

export type StepsCompileHooks = {
  /** Registers a Handlebars expression and returns the marker that stands for it. */
  readonly expression: (source: string) => string;
  /** Resolves a variable name to its Handlebars path at the element's position. */
  readonly pathOf: (name: string, element: ScanElement) => string;
  readonly color: string | undefined;
};

// Inline-styled table in every output (mail, PDF, preview): mail clients ignore
// document CSS, and one rendering keeps the three outputs identical. The labels
// stay static text; only the reached/current switch is a Handlebars block, and
// its arguments are a validated path and validated keys.
export function rewriteStepsBlock(element: ScanElement, hooks: StepsCompileHooks): void {
  const name = element.getAttribute("data-steps") ?? "";
  const steps = readDocumentSteps(element);
  if (!isDocumentReferenceName(name) || steps === null) {
    element.remove();
    // skip: an invalid steps block renders nothing
    return;
  }
  const path = hooks.pathOf(name, element);
  const keys = steps.map((step) => step.key).join(",");
  const color =
    hooks.color !== undefined && isHexColor(hooks.color) ? hooks.color : DEFAULT_STEPS_COLOR;
  const when = (index: number, state: "reached" | "current", yes: string, no: string): string =>
    `${hooks.expression(`{{#stepIs ${path} ${index} "${keys}" "${state}"}}`)}${yes}${hooks.expression("{{else}}")}${no}${hooks.expression("{{/stepIs}}")}`;

  const document = element.ownerDocument;
  const table = document.createElement("table");
  table.setAttribute("role", "presentation");
  table.setAttribute("width", "100%");
  table.setAttribute("cellpadding", "0");
  table.setAttribute("cellspacing", "0");
  table.setAttribute("style", "table-layout:fixed;border-collapse:collapse;margin:4px 0 24px 0");
  const row = document.createElement("tr");
  steps.forEach((step, index) => {
    const cell = document.createElement("td");
    cell.setAttribute(
      "style",
      `padding:0 ${index === steps.length - 1 ? 0 : 4}px 0 0;vertical-align:top`,
    );
    const bar = document.createElement("div");
    bar.setAttribute(
      "style",
      `height:4px;line-height:4px;font-size:0;border-radius:2px;background-color:${when(index, "reached", color, TODO_BAR_COLOR)}`,
    );
    const label = document.createElement("div");
    label.setAttribute(
      "style",
      `padding-top:8px;font-size:12px;line-height:1.3;color:${when(index, "reached", REACHED_LABEL_COLOR, TODO_LABEL_COLOR)};font-weight:${when(index, "current", "600", "400")}`,
    );
    label.textContent = step.label;
    cell.append(bar, label);
    row.append(cell);
  });
  table.append(row);
  element.replaceWith(table);
}
