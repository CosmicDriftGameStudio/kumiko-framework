export type DrawerSide = "left" | "right" | "top" | "bottom";

// Must match the static `max(600px,37.5vw)` in sidePanelClass — Tailwind's
// JIT can't read DEFAULT_WIDTH_MIN_PX/DEFAULT_WIDTH_VIEWPORT_RATIO at
// runtime, so the two are kept in sync by hand.
// Same cap as WIDTH_CLASS: an explicit `width` must not outgrow the viewport.
export const MAX_VIEWPORT_WIDTH = "85vw";
const WIDTH_CLASS = "w-[max(600px,37.5vw)] max-w-[85vw] sm:max-w-[max(600px,37.5vw)]";

// "floating": 32px margin + 32px radius so the panel reads as detached from
// the viewport edge, unlike the sheet primitive's flush-edge default.
// "flush" docks it back to that flush-edge default instead, borrowing the
// vendored Sheet's per-side border (only the edge facing the app content).
// Below the narrow-viewport breakpoint neither treatment fits — the JS hook
// decides, not a `sm:` Tailwind prefix, since the resize width below already
// comes from JS and two decision sources is the bug this avoids.
export function sidePanelClass(
  side: DrawerSide,
  narrow: boolean,
  variant: "floating" | "flush",
  belowHeader: boolean,
): string {
  if (narrow) return "inset-0 h-full w-full max-w-none rounded-none border-0 overflow-hidden";
  if (variant === "flush") {
    switch (side) {
      // h-full would pin height to 100vh despite the shifted top; h-auto lets inset-y-0 size it.
      case "left":
        return `inset-y-0 left-0 ${belowHeader ? "h-auto" : "h-full"} ${WIDTH_CLASS} border-r shadow-2xl overflow-hidden`;
      case "top":
        return `inset-x-0 ${belowHeader ? "top-(--shell-header-height)" : "top-0"} h-auto max-h-[80vh] border-b shadow-2xl overflow-hidden`;
      case "bottom":
        return "inset-x-0 bottom-0 h-auto max-h-[80vh] border-t shadow-2xl overflow-hidden";
      default:
        return `inset-y-0 right-0 ${belowHeader ? "h-auto" : "h-full"} ${WIDTH_CLASS} border-l shadow-2xl overflow-hidden`;
    }
  }
  switch (side) {
    case "left":
      return `inset-y-8 left-8 h-auto ${WIDTH_CLASS} rounded-[2rem] border shadow-2xl overflow-hidden`;
    case "top":
      return "inset-x-8 top-8 h-auto max-h-[80vh] rounded-[2rem] border shadow-2xl overflow-hidden";
    case "bottom":
      return "inset-x-8 bottom-8 h-auto max-h-[80vh] rounded-[2rem] border shadow-2xl overflow-hidden";
    default:
      return `inset-y-8 right-8 h-auto ${WIDTH_CLASS} rounded-[2rem] border shadow-2xl overflow-hidden`;
  }
}
