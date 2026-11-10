// Print-only styling of the document model: character and paragraph styles, absolutely placed
// frames, table borders and cell backgrounds. Serialized as data-* attributes (never style) so
// the sanitizer keeps its guarantee that no CSS comes from the input; compile-document-styles.ts
// turns the validated values into CSS. The read* functions are the single place that validates a
// raw attribute, used by the tiptap parse rules here and by the compile step.
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
import { DOCUMENT_FONTS, type DocumentFont } from "./document-fonts.ts";
import type {
  DocumentBlockStyle,
  DocumentFrameBox,
  DocumentTextStyle,
} from "./document-style-css.ts";
import { HEX_COLOR_PATTERN } from "./mail-layout-constants.ts";

export const TEXT_SIZE_PT_RANGE = { min: 4, max: 72 } as const;
export const LINE_HEIGHT_RANGE = { min: 0.8, max: 3 } as const;
export const PARAGRAPH_SPACE_PT_RANGE = { min: 0, max: 200 } as const;
export const FRAME_MM_RANGE = { min: 0, max: 1000 } as const;
export const COLWIDTH_PX_RANGE = { min: 1, max: 5000 } as const;

export const FRAME_PRESETS = ["address", "text"] as const;
export type DocumentFramePreset = (typeof FRAME_PRESETS)[number];

type AttributeSource = { getAttribute(name: string): string | null };

type Range = { readonly min: number; readonly max: number };

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

function readNumber(raw: string | null, range: Range): number | null {
  if (raw === null || !PLAIN_DECIMAL.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= range.min && value <= range.max ? value : null;
}

function readHexColor(raw: string | null): string | null {
  return raw !== null && HEX_COLOR_PATTERN.test(raw) ? raw : null;
}

function readFont(raw: string | null): DocumentFont | null {
  return isOneOf(DOCUMENT_FONTS, raw) ? raw : null;
}

export function readTextStyleAttributes(element: AttributeSource): Required<DocumentTextStyle> {
  return {
    color: readHexColor(element.getAttribute("data-color")),
    font: readFont(element.getAttribute("data-font")),
    sizePt: readNumber(element.getAttribute("data-size-pt"), TEXT_SIZE_PT_RANGE),
  };
}

export function readBlockStyleAttributes(element: AttributeSource): Required<DocumentBlockStyle> {
  return {
    lineHeight: readNumber(element.getAttribute("data-line-height"), LINE_HEIGHT_RANGE),
    spaceBeforePt: readNumber(element.getAttribute("data-space-before"), PARAGRAPH_SPACE_PT_RANGE),
    spaceAfterPt: readNumber(element.getAttribute("data-space-after"), PARAGRAPH_SPACE_PT_RANGE),
  };
}

export type DocumentFrameAttributes = DocumentFrameBox & {
  readonly preset: DocumentFramePreset | null;
  readonly reserveFlow: boolean;
};

export function readFrameAttributes(element: AttributeSource): DocumentFrameAttributes | null {
  const xMm = readNumber(element.getAttribute("data-x"), FRAME_MM_RANGE);
  const yMm = readNumber(element.getAttribute("data-y"), FRAME_MM_RANGE);
  const widthMm = readNumber(element.getAttribute("data-width"), FRAME_MM_RANGE);
  const heightMm = readNumber(element.getAttribute("data-height"), FRAME_MM_RANGE);
  if (xMm === null || yMm === null || widthMm === null || heightMm === null) return null;
  const preset = element.getAttribute("data-frame-preset");
  return {
    xMm,
    yMm,
    widthMm,
    heightMm,
    preset: isOneOf(FRAME_PRESETS, preset) ? preset : null,
    reserveFlow: element.getAttribute("data-frame-flow") !== "over",
  };
}

export function readCellBackground(element: AttributeSource): string | null {
  return readHexColor(element.getAttribute("data-background"));
}

export function readColwidth(element: AttributeSource): number[] | null {
  const raw = element.getAttribute("data-colwidth");
  if (raw === null) return null;
  const widths = raw.split(",").map((part) => readNumber(part.trim(), COLWIDTH_PX_RANGE));
  return widths.length > 0 && widths.every((width): width is number => width !== null)
    ? widths
    : null;
}

function definedAttributes(entries: ReadonlyArray<readonly [string, unknown]>) {
  return Object.fromEntries(
    entries.filter(([, value]) => value !== null && value !== undefined && value !== false),
  );
}

export const DocumentTextStyleMark = Mark.create({
  name: "documentTextStyle",
  addAttributes() {
    return { color: { default: null }, font: { default: null }, sizePt: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-text-style]",
        getAttrs: (element) => {
          const style = readTextStyleAttributes(element);
          return style.color === null && style.font === null && style.sizePt === null
            ? false
            : style;
        },
      },
    ];
  },
  renderHTML({ mark }) {
    return [
      "span",
      {
        "data-text-style": "",
        ...definedAttributes([
          ["data-color", mark.attrs["color"]],
          ["data-font", mark.attrs["font"]],
          ["data-size-pt", mark.attrs["sizePt"]],
        ]),
      },
      0,
    ];
  },
});

function numberAttribute(attribute: string, range: Range, key: string) {
  return {
    default: null,
    parseHTML: (element: AttributeSource) => readNumber(element.getAttribute(attribute), range),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value: unknown = attributes[key];
      return typeof value === "number" ? { [attribute]: String(value) } : {};
    },
  };
}

export const DocumentBlockStyleAttributes = Extension.create({
  name: "documentBlockStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: numberAttribute("data-line-height", LINE_HEIGHT_RANGE, "lineHeight"),
          spaceBeforePt: numberAttribute(
            "data-space-before",
            PARAGRAPH_SPACE_PT_RANGE,
            "spaceBeforePt",
          ),
          spaceAfterPt: numberAttribute(
            "data-space-after",
            PARAGRAPH_SPACE_PT_RANGE,
            "spaceAfterPt",
          ),
        },
      },
    ];
  },
});

export const documentTableBordersAttribute = {
  borders: {
    default: null,
    parseHTML: (element: AttributeSource) =>
      element.getAttribute("data-borders") === "none" ? "none" : null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes["borders"] === "none" ? { "data-borders": "none" } : {},
  },
};

export const documentCellPrintAttributes = {
  background: {
    default: null,
    parseHTML: (element: AttributeSource) => readCellBackground(element),
    renderHTML: (attributes: Record<string, unknown>) => {
      const background: unknown = attributes["background"];
      return typeof background === "string" && HEX_COLOR_PATTERN.test(background)
        ? { "data-background": background }
        : {};
    },
  },
  colwidth: {
    default: null,
    parseHTML: (element: AttributeSource) => readColwidth(element),
    renderHTML: (attributes: Record<string, unknown>) => {
      const widths: unknown = attributes["colwidth"];
      return Array.isArray(widths) && widths.length > 0
        ? { "data-colwidth": widths.join(",") }
        : {};
    },
  },
};

export const DocumentFrame = Node.create({
  name: "documentFrame",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      xMm: { default: 0 },
      yMm: { default: 0 },
      widthMm: { default: 0 },
      heightMm: { default: 0 },
      preset: { default: null },
      reserveFlow: { default: true },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-frame]",
        getAttrs: (element) => readFrameAttributes(element) ?? false,
      },
    ];
  },
  renderHTML({ node }) {
    const { xMm, yMm, widthMm, heightMm, preset, reserveFlow } = node.attrs;
    return [
      "div",
      mergeAttributes(
        { "data-frame": "" },
        {
          "data-x": String(xMm),
          "data-y": String(yMm),
          "data-width": String(widthMm),
          "data-height": String(heightMm),
        },
        isOneOf(FRAME_PRESETS, preset) ? { "data-frame-preset": preset } : {},
        reserveFlow === false ? { "data-frame-flow": "over" } : {},
      ),
      0,
    ];
  },
});
