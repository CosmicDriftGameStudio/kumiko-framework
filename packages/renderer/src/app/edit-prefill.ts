import type { EditFieldSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import type { CurrentUser } from "../current-user.tsx";

type NormalizedEditField = Exclude<EditFieldSpec, string>;

/** Calendar date (`YYYY-MM-DD`) of `now` in the given IANA zone. The en-CA
 *  locale is used only because it formats dates as year-month-day. */
export function todayInTimeZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export type EditPrefillContext = {
  readonly now: Date;
  /** Fallback zone when the user carries none (resolver or browser zone). */
  readonly fallbackTimeZone: string;
  readonly user: CurrentUser | undefined;
};

/** Fills empty values of fields that declare `prefill`. Only meant for the
 *  create form: existing values (defaults, URL params, handoff) always win. */
export function applyEditPrefill(
  initial: Readonly<Record<string, unknown>>,
  specs: readonly NormalizedEditField[],
  context: EditPrefillContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...initial };
  for (const spec of specs) {
    const { prefill } = spec;
    if (prefill === undefined || !isEmptyValue(out[spec.field])) continue;
    if (prefill.kind === "today") {
      out[spec.field] = todayInTimeZone(
        context.now,
        context.user?.timeZone ?? context.fallbackTimeZone,
      );
    } else if (context.user !== undefined) {
      out[spec.field] = context.user[prefill.property];
    }
  }
  return out;
}
