import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";

export type StatusTone = "ok" | "warn" | "bad" | "critical" | "muted";

/** Tones a select option can request: the status tones plus the brand `accent`. */
export type StatusBadgeOptionTone = StatusTone | "accent";

// Status value -> StatusTone heuristic, shared by every surface that shows a
// raw status value without a tone of its own (projectionDetail header badge,
// list cells). Covers the common status vocabularies; unknown values stay
// undefined so the caller keeps its own neutral default.
const STATUS_TONE_BY_VALUE: Readonly<Record<string, StatusTone>> = {
  ok: "ok",
  active: "ok",
  done: "ok",
  complete: "ok",
  completed: "ok",
  paid: "ok",
  approved: "ok",
  published: "ok",
  success: "ok",
  pending: "warn",
  processing: "warn",
  review: "warn",
  "in-review": "warn",
  waiting: "warn",
  open: "warn",
  draft: "warn",
  failed: "bad",
  error: "bad",
  overdue: "bad",
  rejected: "bad",
  blocked: "bad",
  critical: "bad",
};

const STATUS_TONE_BY_OPTION_TONE: Readonly<Record<SelectOptionTone, StatusBadgeOptionTone>> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
  critical: "critical",
  accent: "accent",
  neutral: "muted",
};

// Own-key check: an unknown tone from an untyped definition must yield undefined so callers fall back to the value heuristic.
export function statusToneForOptionTone(tone: SelectOptionTone): StatusBadgeOptionTone | undefined {
  return Object.hasOwn(STATUS_TONE_BY_OPTION_TONE, tone)
    ? STATUS_TONE_BY_OPTION_TONE[tone]
    : undefined;
}

export function statusToneForValue(value: string): StatusTone | undefined {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  // Own-key check: the value comes from row data, and a plain object lookup
  // would hand back `Object.prototype.constructor` & friends as a "tone".
  return Object.hasOwn(STATUS_TONE_BY_VALUE, slug) ? STATUS_TONE_BY_VALUE[slug] : undefined;
}
