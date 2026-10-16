// @runtime client
import type {
  LinkedResourceView,
  MailCategory,
  MailDraft,
  MailVariable,
  PlaceholderType,
  TemplateRowView,
} from "./mail-types.js";

export const EMPTY_DRAFT: MailDraft = {
  subject: "",
  previewText: "",
  layoutSlug: "",
  category: "",
  body: "",
};

export const PLACEHOLDER_SYMBOL: Readonly<Record<PlaceholderType, string>> = {
  text: "T",
  money: "€",
  date: "D",
  link: "↗",
  list: "≡",
};

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

export type LoadedMail = {
  readonly draft: MailDraft;
  // The sender is passed through untouched: the editor does not edit it.
  readonly sender: unknown;
};

export function loadedMailOf(row: TemplateRowView | null): LoadedMail {
  if (row === null) return { draft: EMPTY_DRAFT, sender: undefined };
  const meta = parseJsonRecord(row.meta);
  return {
    draft: {
      subject: textOf(meta["subject"]),
      previewText: textOf(meta["previewText"]),
      layoutSlug: textOf(meta["layoutSlug"]),
      category: categoryOf(meta["category"]),
      body: row.content,
    },
    sender: meta["sender"],
  };
}

export function buildMeta(draft: MailDraft, sender: unknown): Record<string, unknown> {
  return {
    subject: draft.subject,
    ...(draft.previewText !== "" && { previewText: draft.previewText }),
    ...(draft.layoutSlug !== "" && { layoutSlug: draft.layoutSlug }),
    ...(draft.category !== "" && { category: draft.category }),
    ...(sender !== undefined && { sender }),
  };
}

export function isDraftDirty(current: MailDraft, saved: MailDraft): boolean {
  return (
    current.subject !== saved.subject ||
    current.previewText !== saved.previewText ||
    current.layoutSlug !== saved.layoutSlug ||
    current.category !== saved.category ||
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
  variables: Readonly<Record<string, MailVariable>>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [name, variable] of Object.entries(variables)) {
    if (variable.label !== undefined) labels[name] = variable.label;
    for (const [itemName, item] of Object.entries(variable.item ?? {})) {
      if (item.label !== undefined) labels[`${name}.${itemName}`] = item.label;
    }
  }
  return labels;
}

export function displayValue(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  value: unknown,
): string {
  if (Array.isArray(value))
    return t("documentDesigner.mail.preview.entries", { count: value.length });
  if (isRecord(value)) {
    const { amount, currency } = value;
    if (typeof amount === "number" && typeof currency === "string") return `${amount} ${currency}`;
    return JSON.stringify(value);
  }
  return String(value ?? "");
}
