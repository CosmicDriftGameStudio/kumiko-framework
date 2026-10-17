// @runtime client
import {
  PDF_ORIENTATIONS,
  PDF_PAGE_FORMATS,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { isOneOf, isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

export type PageFormat = (typeof PDF_PAGE_FORMATS)[number];
export type Orientation = (typeof PDF_ORIENTATIONS)[number];

export type MarginSide = "top" | "right" | "bottom" | "left";
export const MARGIN_SIDES = [
  "top",
  "right",
  "bottom",
  "left",
] as const satisfies readonly MarginSide[];

export type PdfMetaDraft = {
  readonly layoutSlug: string;
  readonly pageFormat: PageFormat;
  readonly orientation: Orientation;
  readonly printBackground: boolean;
  readonly layoutHeaderFooter: boolean;
  readonly margins: Readonly<Record<MarginSide, number | "">>;
  readonly fileName: string;
  readonly title: string;
  readonly author: string;
};

export const EMPTY_PDF_META: PdfMetaDraft = {
  layoutSlug: "",
  pageFormat: "A4",
  orientation: "portrait",
  printBackground: true,
  layoutHeaderFooter: true,
  margins: { top: "", right: "", bottom: "", left: "" },
  fileName: "",
  title: "",
  author: "",
};

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function marginOf(margins: unknown, side: MarginSide): number | "" {
  const value = propertyOf(margins, side);
  return typeof value === "number" ? value : "";
}

/** Reads the stored meta JSON string; unknown or malformed parts fall back to the defaults. */
export function parsePdfMeta(raw: string | null): PdfMetaDraft {
  if (raw === null) return EMPTY_PDF_META;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PDF_META;
  }
  if (!isPlainObject(parsed)) return EMPTY_PDF_META;
  const pageFormat = propertyOf(parsed, "pageFormat");
  const orientation = propertyOf(parsed, "orientation");
  const margins = propertyOf(parsed, "margins");
  const metadata = propertyOf(parsed, "metadata");
  return {
    layoutSlug: stringOr(parsed["layoutSlug"], ""),
    pageFormat: isOneOf(PDF_PAGE_FORMATS, pageFormat) ? pageFormat : EMPTY_PDF_META.pageFormat,
    orientation: isOneOf(PDF_ORIENTATIONS, orientation) ? orientation : EMPTY_PDF_META.orientation,
    printBackground: booleanOr(parsed["printBackground"], true),
    layoutHeaderFooter: booleanOr(parsed["layoutHeaderFooter"], true),
    margins: {
      top: marginOf(margins, "top"),
      right: marginOf(margins, "right"),
      bottom: marginOf(margins, "bottom"),
      left: marginOf(margins, "left"),
    },
    fileName: stringOr(parsed["fileName"], ""),
    title: stringOr(propertyOf(metadata, "title"), ""),
    author: stringOr(propertyOf(metadata, "author"), ""),
  };
}

/** Builds the meta object for the server; defaults and empty fields are left out. */
export function serializePdfMeta(draft: PdfMetaDraft): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (draft.layoutSlug !== "") meta["layoutSlug"] = draft.layoutSlug;
  if (draft.pageFormat !== "A4") meta["pageFormat"] = draft.pageFormat;
  if (draft.orientation !== "portrait") meta["orientation"] = draft.orientation;
  if (!draft.printBackground) meta["printBackground"] = false;
  if (!draft.layoutHeaderFooter) meta["layoutHeaderFooter"] = false;
  // Unset sides stay out so the renderer's per-side fallbacks (header/footer margins) still apply.
  const setMargins = MARGIN_SIDES.flatMap((side) => {
    const mm = draft.margins[side];
    return mm === "" ? [] : [[side, mm] as const];
  });
  if (setMargins.length > 0) meta["margins"] = Object.fromEntries(setMargins);
  if (draft.fileName.trim() !== "") meta["fileName"] = draft.fileName.trim();
  const metadata: Record<string, string> = {};
  if (draft.title.trim() !== "") metadata["title"] = draft.title.trim();
  if (draft.author.trim() !== "") metadata["author"] = draft.author.trim();
  if (Object.keys(metadata).length > 0) meta["metadata"] = metadata;
  return meta;
}
