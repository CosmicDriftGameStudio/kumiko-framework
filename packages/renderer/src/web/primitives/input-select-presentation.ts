import { defaultSelectPresentation } from "./field.tsx";
import { hasDescriptionOrGroup } from "./option-groups.ts";

type SelectPresentation = ReturnType<typeof defaultSelectPresentation>;

type PresentationOption = {
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
};

type PresentationRequest = {
  readonly radioVariant?: "list" | "card";
  readonly display?: "radio" | "dropdown";
};

// An explicit `display` is an author decision and outranks the heuristic in
// both directions — a requested radio group renders as one even when the
// options outnumber the heuristic's threshold.
function requestedSelectPresentation(
  { radioVariant, display }: PresentationRequest,
  options: readonly PresentationOption[],
): SelectPresentation {
  if (radioVariant === "card") return "radioList";
  if (display === "radio") return "segmented";
  if (display === "dropdown") return "dropdown";
  return defaultSelectPresentation(options);
}

// A segmented control has no room for a description line or group headings.
export function resolveSelectPresentation(
  request: PresentationRequest,
  options: readonly PresentationOption[],
): SelectPresentation {
  const requested = requestedSelectPresentation(request, options);
  return requested === "segmented" && hasDescriptionOrGroup(options) ? "radioList" : requested;
}
