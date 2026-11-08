import type { CSSProperties } from "react";

// Places a suffix right behind the typed text of a full-width input. Digits are
// ~1ch wide with tabular-nums, so the text length approximates its width.
export function inlineSuffixStyle(text: string): CSSProperties {
  return { left: `calc(0.75rem + ${text.length}ch + 0.375rem)` };
}
