// Pure format utilities — no web or platform dependencies.
// Shared between renderer-web, renderer-native, and server-side tests.

function formatDateCell(
  value: unknown,
  type: string,
  opts?: {
    locale?: string;
    dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
    timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
  },
): string {
  try {
    const raw = typeof value === "string" ? value : String(value);
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const locale = opts?.locale;
    if (opts?.dateStyle || opts?.timeStyle) {
      return date.toLocaleString(locale, {
        dateStyle: opts.dateStyle,
        timeStyle: opts.timeStyle,
      });
    }
    if (type === "date") return date.toLocaleDateString(locale);
    return date.toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export { escapeHtml, escapeHtmlAttr, escapeXml } from "./escape";
export { type HtmlValue, html, RawHtml, raw } from "./html-template";
export function applyFormatSpec(
  spec: { format: string } & Record<string, unknown>,
  value: unknown,
): string {
  const isEmpty = value === null || value === undefined || value === "";
  // priority renders its emptyLabel for empty values — every other format
  // collapses empty to "".
  if (isEmpty && spec.format !== "priority") return "";
  switch (spec.format) {
    case "timestamp":
    case "date":
      return formatDateCell(value, spec.format, {
        locale: spec["locale"] as string | undefined,
        dateStyle: spec["dateStyle"] as Intl.DateTimeFormatOptions["dateStyle"],
        timeStyle:
          spec.format === "timestamp"
            ? (spec["timeStyle"] as Intl.DateTimeFormatOptions["timeStyle"])
            : undefined,
      });
    case "boolean": {
      if (value === true) return (spec["trueLabel"] as string | undefined) ?? "✓";
      if (value === false) return (spec["falseLabel"] as string | undefined) ?? "";
      return "";
    }
    case "currency": {
      const sym = (spec["symbol"] as string | undefined) ?? "";
      return sym.length > 0 ? `${value} ${sym}` : String(value);
    }
    case "priority": {
      const emptyLabel = (spec["emptyLabel"] as string | undefined) ?? "—";
      const prefix = (spec["prefix"] as string | undefined) ?? "";
      if (isEmpty || value === 0) return emptyLabel;
      return `${prefix}${value}`;
    }
    default:
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        // biome-ignore lint/suspicious/noConsole: dev-only warning
        console.warn(
          `[kumiko] applyFormatSpec: unknown format key "${spec.format}" — registered via FieldFormatRegistry module augmentation?`,
        );
      }
      return typeof value === "string" ? value : String(value);
  }
}
