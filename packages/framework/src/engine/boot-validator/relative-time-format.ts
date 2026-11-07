import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_SCREEN_RULES } from "./screens-lists-rules.ts";

const RELATIVE_TIME_STYLES: readonly unknown[] = ["long", "short", "narrow"];

function isKnownTimeZone(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function relativeTimeOptionProblem(format: unknown): string | undefined {
  const style = propertyOf(format, "style");
  if (style !== undefined && !RELATIVE_TIME_STYLES.includes(style)) {
    return `style ${String(style)} (expected long, short or narrow)`;
  }
  const absoluteAfterDays = propertyOf(format, "absoluteAfterDays");
  if (
    absoluteAfterDays !== undefined &&
    !(
      typeof absoluteAfterDays === "number" &&
      Number.isInteger(absoluteAfterDays) &&
      absoluteAfterDays >= 1
    )
  ) {
    return `absoluteAfterDays ${String(absoluteAfterDays)} (expected an integer of at least 1)`;
  }
  const timeZone = propertyOf(format, "timeZone");
  if (timeZone !== undefined && !isKnownTimeZone(timeZone)) {
    return `timeZone ${String(timeZone)} (expected an IANA zone id such as Europe/Berlin)`;
  }
  const withTime = propertyOf(format, "withTime");
  if (withTime !== undefined && typeof withTime !== "boolean") {
    return `withTime ${String(withTime)} (expected a boolean)`;
  }
  return undefined;
}

// A typo'd option would silently fall back to the plain relative text.
export function validateRelativeTimeFormat(prefix: string, label: string, format: unknown): void {
  // skip: only a relativeTime format has these options
  if (typeof format !== "object" || format === null) return;
  if (propertyOf(format, "format") !== "relativeTime") return;
  const problem = relativeTimeOptionProblem(format);
  if (problem === undefined) return;
  throw bootRuleError(LIST_SCREEN_RULES.relativeTimeOptionsInvalid, {
    message: `${prefix} ${label} has relativeTime option ${problem}.`,
  });
}
