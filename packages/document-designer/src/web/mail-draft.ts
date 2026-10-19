// @runtime client
import {
  DOCUMENT_FALLBACK_CURRENCY,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
} from "@cosmicdrift/kumiko-renderer/headless";
import type {
  LinkedResourceView,
  MailCategory,
  MailDraft,
  MailVariable,
  PlaceholderType,
  TemplateRowView,
} from "./mail-types.ts";
import { variableLabelText } from "./used-by-label.ts";

export const EMPTY_DRAFT: MailDraft = {
  subject: "",
  previewText: "",
  layoutSlug: "",
  category: "",
  senderName: "",
  replyTo: "",
  headerChip: "",
  tone: "",
  footerNote: "",
  body: "",
};

export const PLACEHOLDER_SYMBOL: Readonly<Record<PlaceholderType, string>> = {
  text: "T",
  money: "€",
  date: "D",
  percent: "%",
  link: "↗",
  list: "≡",
};

// Filled in by the layout around the content, so a template that never uses them is fine.
export const LAYOUT_OWNED_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "imprint",
  "unsubscribeUrl",
]);

export const SYSTEM_PLACEHOLDER_TYPE: Readonly<Record<string, PlaceholderType>> = {
  imprint: "link",
  unsubscribeUrl: "link",
};

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export function systemPlaceholderLabel(t: Translate, name: string): string {
  const key = `documentDesigner.placeholder.${name}`;
  const translated = t(key);
  return translated === key ? name : translated;
}

// For places that show a stored {{name}} line as plain text instead of chips.
export function labelPlaceholders(
  line: string,
  variableLabels: Readonly<Record<string, string>>,
): string {
  return line.replace(/\{\{([^{}]*)\}\}/g, (_token, rawName: string) => {
    const name = rawName.trim();
    return Object.hasOwn(variableLabels, name) ? (variableLabels[name] ?? name) : name;
  });
}

// Chips in the editors show these instead of the raw system names.
export function systemLabelMap(
  t: Translate,
  names: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(names.map((name) => [name, systemPlaceholderLabel(t, name)]));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Stored JSON columns come back as a JSON string or an already parsed object.
export function parseJsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value === "") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function categoryOf(value: unknown): MailCategory {
  return value === "transactional" || value === "marketing" ? value : "";
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function loadedMailOf(row: TemplateRowView | null): MailDraft {
  if (row === null) return EMPTY_DRAFT;
  const meta = parseJsonRecord(row.meta);
  return {
    subject: textOf(meta["subject"]),
    previewText: textOf(meta["previewText"]),
    layoutSlug: textOf(meta["layoutSlug"]),
    category: categoryOf(meta["category"]),
    senderName: textOf(meta["senderName"]),
    replyTo: textOf(meta["replyTo"]),
    headerChip: textOf(meta["headerChip"]),
    tone: textOf(meta["tone"]),
    footerNote: textOf(meta["footerNote"]),
    body: row.content,
  };
}

export function buildMeta(draft: MailDraft): Record<string, unknown> {
  return {
    subject: draft.subject,
    ...(draft.previewText !== "" && { previewText: draft.previewText }),
    ...(draft.layoutSlug !== "" && { layoutSlug: draft.layoutSlug }),
    ...(draft.category !== "" && { category: draft.category }),
    ...(draft.senderName !== "" && { senderName: draft.senderName }),
    ...(draft.replyTo !== "" && { replyTo: draft.replyTo }),
    ...(draft.headerChip !== "" && { headerChip: draft.headerChip }),
    ...(draft.tone !== "" && { tone: draft.tone }),
    ...(draft.footerNote !== "" && { footerNote: draft.footerNote }),
  };
}

export function isDraftDirty(current: MailDraft, saved: MailDraft): boolean {
  return (
    current.subject !== saved.subject ||
    current.previewText !== saved.previewText ||
    current.layoutSlug !== saved.layoutSlug ||
    current.category !== saved.category ||
    current.senderName !== saved.senderName ||
    current.replyTo !== saved.replyTo ||
    current.headerChip !== saved.headerChip ||
    current.tone !== saved.tone ||
    current.footerNote !== saved.footerNote ||
    current.body !== saved.body
  );
}

export function parseLinkedResources(value: unknown): readonly LinkedResourceView[] {
  return Object.entries(parseJsonRecord(value)).flatMap(([key, entry]): LinkedResourceView[] => {
    if (typeof entry === "string") return [{ kind: "image", key, fileRefId: entry }];
    if (!isRecord(entry)) return [];
    const fileName = textOf(entry["fileName"]);
    if (entry["kind"] === "file") {
      return [{ kind: "file", key, fileRefId: textOf(entry["fileRefId"]), fileName }];
    }
    if (entry["kind"] === "rendered-pdf") {
      return [{ kind: "pdf", key, templateSlug: textOf(entry["templateSlug"]), fileName }];
    }
    return [];
  });
}

const KEY_MAX_LENGTH = 64;

// Resource keys allow letters, digits, dot, dash and underscore; a taken key gets a numeric suffix.
export function uniqueResourceKey(source: string, taken: readonly string[]): string {
  const withoutExtension = source.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const base =
    withoutExtension
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, KEY_MAX_LENGTH - 4) || "resource";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function lastSlugSegment(slug: string): string {
  const parts = slug.split(":");
  return parts[parts.length - 1] ?? slug;
}

export function formatKilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Labels for the chip editors; list item fields are addressed as "list.item".
export function variableLabelMap(
  t: Translate,
  variables: Readonly<Record<string, MailVariable>>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [name, variable] of Object.entries(variables)) {
    if (variable.label !== undefined) labels[name] = variableLabelText(t, name, variable.label);
    for (const [itemName, item] of Object.entries(variable.item ?? {})) {
      if (item.label !== undefined) {
        labels[`${name}.${itemName}`] = variableLabelText(t, itemName, item.label);
      }
    }
  }
  return labels;
}

export type SampleValueFormat = {
  readonly locale: string;
  // Undefined while the tenant setting is still loading: a bare amount then stays raw
  // instead of showing a currency the rendered mail might not use.
  readonly tenantCurrency: string | undefined;
};

export function displayValue(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  value: unknown,
  type: PlaceholderType | undefined,
  format: SampleValueFormat,
): string {
  if (Array.isArray(value))
    return t("documentDesigner.mail.preview.entries", { count: value.length });
  if (type === "money") {
    if (typeof value === "number" && format.tenantCurrency === undefined) return String(value);
    return formatDocumentMoney(
      value,
      format.tenantCurrency ?? DOCUMENT_FALLBACK_CURRENCY,
      format.locale,
    );
  }
  if (type === "date") return formatDocumentDate(value, format.locale);
  if (type === "percent") return formatDocumentPercent(value, format.locale);
  if (isRecord(value)) return JSON.stringify(value);
  return String(value ?? "");
}
