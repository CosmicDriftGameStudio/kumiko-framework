import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import type { JSONContent } from "@tiptap/core";
import * as z from "zod";
import type { LayoutRegionName } from "./layout-regions.ts";
import type { DocumentOpsKind } from "./web/constants.ts";
import {
  type DocumentToolbarBlock,
  documentBlocksForKind,
  PDF_LAYOUT_DOCUMENT_BLOCKS,
} from "./web/document-blocks.ts";
import { DOCUMENT_FONTS } from "./web/document-fonts.ts";
import {
  CELL_PADDING_MM_RANGE,
  COLWIDTH_PX_RANGE,
  DIVIDER_WEIGHT_PT_RANGE,
  DOCUMENT_IMAGE_ALIGNMENTS,
  DOCUMENT_TABLE_ALIGNMENTS,
  FRAME_MM_RANGE,
  FRAME_PRESETS,
  IMAGE_WIDTH_MM_RANGE,
  LINE_HEIGHT_RANGE,
  PARAGRAPH_SPACE_PT_RANGE,
  TABLE_WIDTH_MM_RANGE,
  TEXT_SIZE_PT_RANGE,
} from "./web/document-print-style.ts";
import {
  DOCUMENT_DATE_STYLES,
  DOCUMENT_TEXT_ALIGNMENTS,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./web/document-schema.ts";
import { HEX_COLOR_PATTERN } from "./web/mail-layout-constants.ts";
import { lineToContent, singleLine } from "./web/placeholder-text.ts";

export const MAX_BODY_BLOCKS = 300;

export const DOCUMENT_BLOCK_INPUT_TYPES = [
  "paragraph",
  "heading",
  "list",
  "table",
  "frame",
  "image",
  "button",
  "divider",
  "pageBreak",
] as const;
export type DocumentBlockInputType = (typeof DOCUMENT_BLOCK_INPUT_TYPES)[number];

type AllowedBlock = DocumentToolbarBlock | "frame";

// Text blocks and lists exist in every kind; every other input type needs its block in the kind's set.
const REQUIRED_BLOCK: Readonly<Record<DocumentBlockInputType, AllowedBlock | null>> = {
  paragraph: null,
  heading: null,
  list: null,
  table: "table",
  frame: "frame",
  image: "image",
  button: "button",
  divider: "divider",
  pageBreak: "pageBreak",
};

// A frame sits on the page of a PDF body; layout regions and mails have none.
export function allowedBlocksFor(kind: DocumentOpsKind): readonly AllowedBlock[] {
  if (kind === "pdf-layout") return PDF_LAYOUT_DOCUMENT_BLOCKS;
  const blocks = documentBlocksForKind(kind);
  return kind === "document-pdf" ? [...blocks, "frame"] : blocks;
}

function isBlockTypeAllowed(type: DocumentBlockInputType, kind: DocumentOpsKind): boolean {
  const required = REQUIRED_BLOCK[type];
  return required === null || allowedBlocksFor(kind).includes(required);
}

export function patchIssue(
  path: string,
  code: string,
  params?: Readonly<Record<string, unknown>>,
): FieldIssue {
  const camel = code.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return {
    path,
    code,
    i18nKey: `templateResolver.errors.patch.${camel}`,
    ...(params === undefined ? {} : { params }),
  };
}

const singleLineText = z.string().max(2000);
const hexColor = z.string().regex(HEX_COLOR_PATTERN, "must be a #rrggbb color");
const rangeNumber = (range: { readonly min: number; readonly max: number }) =>
  z.number().min(range.min).max(range.max);
const alignSchema = z.enum(DOCUMENT_TEXT_ALIGNMENTS);

const textStyleSchema = z.object({
  font: z.enum(DOCUMENT_FONTS).optional(),
  sizePt: rangeNumber(TEXT_SIZE_PT_RANGE).optional(),
  color: hexColor.optional(),
});

const runSchema = textStyleSchema.extend({
  text: singleLineText,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  dateStyle: z.enum(DOCUMENT_DATE_STYLES).optional(),
});
// A line break inside a paragraph or table cell; the lines around it keep their own formatting.
const hardBreakSchema = z.object({ hardBreak: z.literal(true) });
const runsSchema = z
  .array(z.union([runSchema, hardBreakSchema]))
  .min(1)
  .max(50);

const blockStyleSchema = z.object({
  lineHeight: rangeNumber(LINE_HEIGHT_RANGE).optional(),
  spaceBeforePt: rangeNumber(PARAGRAPH_SPACE_PT_RANGE).optional(),
  spaceAfterPt: rangeNumber(PARAGRAPH_SPACE_PT_RANGE).optional(),
});

const textFormatShape = {
  align: alignSchema.optional(),
  style: blockStyleSchema.optional(),
  textStyle: textStyleSchema.optional(),
};

// Either text or runs; the pair is checked when the node is built, because a refinement would hide the shape from a tool schema.
const inlineShape = { text: singleLineText.optional(), runs: runsSchema.optional() };

const cellSchema = z.object({
  ...inlineShape,
  background: hexColor.optional(),
  align: alignSchema.optional(),
});
// A rule over or under a row, e.g. the dark line under a table header or above a total.
const rowLineSchema = z.object({
  color: hexColor,
  weightPt: rangeNumber(DIVIDER_WEIGHT_PT_RANGE),
});
const rowSchema = z.object({
  cells: z.array(cellSchema).min(1).max(20),
  lineAbove: rowLineSchema.optional(),
  lineBelow: rowLineSchema.optional(),
});

const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  ...inlineShape,
  ...textFormatShape,
});
const headingSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(3),
  ...inlineShape,
  ...textFormatShape,
});
const listSchema = z.object({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z
    .array(z.union([singleLineText, runsSchema]))
    .min(1)
    .max(100),
  ...textFormatShape,
});
const tableSchema = z.object({
  type: z.literal("table"),
  borders: z.literal("none").optional(),
  cellPaddingMm: rangeNumber(CELL_PADDING_MM_RANGE).optional(),
  widthMm: rangeNumber(TABLE_WIDTH_MM_RANGE).optional(),
  align: z.enum(DOCUMENT_TABLE_ALIGNMENTS).optional(),
  columnWidthsPx: z.array(rangeNumber(COLWIDTH_PX_RANGE)).min(1).max(20).optional(),
  header: rowSchema.optional(),
  rows: z.array(rowSchema).max(100),
  repeat: z.object({ each: z.string().min(1).max(100), row: rowSchema }).optional(),
  rowsAfterRepeat: z.array(rowSchema).max(100).optional(),
});
const imageSchema = z.object({
  type: z.literal("image"),
  resource: z.string().min(1).max(200),
  alt: z.string().max(500).optional(),
  widthMm: rangeNumber(IMAGE_WIDTH_MM_RANGE).optional(),
  align: z.enum(DOCUMENT_IMAGE_ALIGNMENTS).optional(),
  bleed: z.boolean().optional(),
});
const dividerSchema = z.object({
  type: z.literal("divider"),
  color: hexColor.optional(),
  weightPt: rangeNumber(DIVIDER_WEIGHT_PT_RANGE).optional(),
});

const frameSchema = z.object({
  type: z.literal("frame"),
  xMm: rangeNumber(FRAME_MM_RANGE),
  yMm: rangeNumber(FRAME_MM_RANGE),
  widthMm: rangeNumber(FRAME_MM_RANGE),
  heightMm: rangeNumber(FRAME_MM_RANGE),
  preset: z.enum(FRAME_PRESETS).optional(),
  reserveFlow: z.boolean().optional(),
  blocks: z
    .array(
      z.discriminatedUnion("type", [
        paragraphSchema,
        headingSchema,
        listSchema,
        tableSchema,
        imageSchema,
      ]),
    )
    .min(1)
    .max(30),
});

export const blockInputSchema = z.discriminatedUnion("type", [
  paragraphSchema,
  headingSchema,
  listSchema,
  tableSchema,
  frameSchema,
  imageSchema,
  z.object({ type: z.literal("button"), text: singleLineText, href: z.string().max(300) }),
  dividerSchema,
  z.object({ type: z.literal("pageBreak") }),
]);

export type BlockInput = z.infer<typeof blockInputSchema>;
export const blockFormatSchema = z.object(textFormatShape);
export type TextFormat = z.infer<typeof blockFormatSchema>;
type Mark = NonNullable<JSONContent["marks"]>[number];
type TextStyle = z.infer<typeof textStyleSchema>;
type Run = z.infer<typeof runSchema>;
type RunOrBreak = z.infer<typeof runsSchema>[number];
type Row = z.infer<typeof rowSchema>;
type InlineSource = {
  readonly text?: string | undefined;
  readonly runs?: readonly RunOrBreak[] | undefined;
};

export type BuildContext = {
  readonly kind: DocumentOpsKind;
  readonly region?: LayoutRegionName | undefined;
  readonly issues: FieldIssue[];
};

function report(
  ctx: BuildContext,
  path: string,
  code: string,
  params?: Readonly<Record<string, unknown>>,
): void {
  ctx.issues.push(patchIssue(path, code, params));
}

export function countBlocks(blocks: readonly BlockInput[]): number {
  return blocks.reduce(
    (sum, block) => sum + 1 + (block.type === "frame" ? block.blocks.length : 0),
    0,
  );
}

function isTextStyleSet(style: TextStyle): boolean {
  return style.font !== undefined || style.sizePt !== undefined || style.color !== undefined;
}

function textStyleMarks(style: TextStyle): Mark[] {
  if (!isTextStyleSet(style)) return [];
  return [
    {
      type: "documentTextStyle",
      attrs: { color: style.color ?? null, font: style.font ?? null, sizePt: style.sizePt ?? null },
    },
  ];
}

function runMarks(run: Run): Mark[] {
  return [
    ...(run.bold === true ? [{ type: "bold" }] : []),
    ...(run.italic === true ? [{ type: "italic" }] : []),
    ...(run.underline === true ? [{ type: "underline" }] : []),
  ];
}

function withMarks(nodes: JSONContent[], marks: Mark[]): JSONContent[] {
  return marks.length === 0
    ? nodes
    : nodes.map((node) => ({ ...node, marks: [...(node.marks ?? []), ...marks] }));
}

function definedStyle(style: TextStyle): TextStyle {
  return {
    ...(style.font === undefined ? {} : { font: style.font }),
    ...(style.sizePt === undefined ? {} : { sizePt: style.sizePt }),
    ...(style.color === undefined ? {} : { color: style.color }),
  };
}

function inlineNodes(
  ctx: BuildContext,
  path: string,
  source: InlineSource,
  blockStyle: TextStyle | undefined,
): JSONContent[] {
  const { text, runs } = source;
  if ((text === undefined) === (runs === undefined)) {
    report(ctx, path, "text_or_runs_required");
    return [];
  }
  const base = blockStyle === undefined ? {} : definedStyle(blockStyle);
  if (runs === undefined) {
    return withMarks(lineToContent(singleLine(text ?? "")), textStyleMarks(base));
  }
  return runs.flatMap((run): JSONContent[] =>
    "hardBreak" in run
      ? [{ type: "hardBreak" }]
      : withMarks(lineToContent(singleLine(run.text), run.dateStyle), [
          ...runMarks(run),
          ...textStyleMarks({ ...base, ...definedStyle(run) }),
        ]),
  );
}

function formatAttributes(
  ctx: BuildContext,
  path: string,
  format: TextFormat,
): Record<string, unknown> {
  if (format.align !== undefined && !allowedBlocksFor(ctx.kind).includes("align")) {
    report(ctx, `${path}.align`, "block_not_allowed", { type: "align", kind: ctx.kind });
  }
  const { style } = format;
  return {
    ...(format.align === undefined ? {} : { textAlign: format.align }),
    ...(style?.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
    ...(style?.spaceBeforePt === undefined ? {} : { spaceBeforePt: style.spaceBeforePt }),
    ...(style?.spaceAfterPt === undefined ? {} : { spaceAfterPt: style.spaceAfterPt }),
  };
}

function textBlockNode(
  ctx: BuildContext,
  path: string,
  type: "paragraph" | "heading",
  source: InlineSource,
  format: TextFormat,
  level?: number,
): JSONContent {
  const attrs = {
    ...(level === undefined ? {} : { level }),
    ...formatAttributes(ctx, path, format),
  };
  return {
    type,
    ...(Object.keys(attrs).length === 0 ? {} : { attrs }),
    content: inlineNodes(ctx, path, source, format.textStyle),
  };
}

function listNode(ctx: BuildContext, path: string, block: Extract<BlockInput, { type: "list" }>) {
  return {
    type: block.ordered ? "orderedList" : "bulletList",
    content: block.items.map((item, index): JSONContent => {
      const source: InlineSource = typeof item === "string" ? { text: item } : { runs: item };
      return {
        type: "listItem",
        content: [textBlockNode(ctx, `${path}.items.${index}`, "paragraph", source, block)],
      };
    }),
  };
}

function rowNode(
  ctx: BuildContext,
  path: string,
  row: Row,
  options: {
    readonly header: boolean;
    readonly widths: readonly number[] | undefined;
    readonly attrs?: Record<string, unknown>;
  },
): JSONContent {
  if (options.widths !== undefined && options.widths.length !== row.cells.length) {
    report(ctx, `${path}.cells`, "invalid_table", {
      problem: "columnWidthsPx must match the cells per row",
    });
  }
  const attrs = {
    ...options.attrs,
    ...(row.lineAbove === undefined ? {} : { lineAbove: row.lineAbove }),
    ...(row.lineBelow === undefined ? {} : { lineBelow: row.lineBelow }),
  };
  return {
    type: "tableRow",
    ...(Object.keys(attrs).length === 0 ? {} : { attrs }),
    content: row.cells.map((cell, index): JSONContent => {
      const width = options.widths?.[index];
      const attrs = {
        ...(cell.background === undefined ? {} : { background: cell.background }),
        ...(width === undefined ? {} : { colwidth: [width] }),
      };
      const cellPath = `${path}.cells.${index}`;
      return {
        type: options.header ? "tableHeader" : "tableCell",
        ...(Object.keys(attrs).length === 0 ? {} : { attrs }),
        content: [textBlockNode(ctx, cellPath, "paragraph", cell, { align: cell.align })],
      };
    }),
  };
}

function reportInvalidRepeat(
  ctx: BuildContext,
  path: string,
  repeat: Extract<BlockInput, { type: "table" }>["repeat"],
): void {
  if (repeat === undefined) return;
  if (!isDocumentReferenceName(repeat.each)) {
    report(ctx, `${path}.repeat.each`, "invalid_repeat_variable", { each: repeat.each });
  }
  if (!allowedBlocksFor(ctx.kind).includes("repeat")) {
    report(ctx, `${path}.repeat`, "block_not_allowed", { type: "repeat", kind: ctx.kind });
  }
}

function tableAttrsOf(block: Extract<BlockInput, { type: "table" }>) {
  return {
    ...(block.borders === undefined ? {} : { borders: block.borders }),
    ...(block.cellPaddingMm === undefined ? {} : { cellPaddingMm: block.cellPaddingMm }),
    ...(block.widthMm === undefined ? {} : { widthMm: block.widthMm }),
    ...(block.align === undefined ? {} : { align: block.align }),
  };
}

function tableNode(ctx: BuildContext, path: string, block: Extract<BlockInput, { type: "table" }>) {
  const widths = block.columnWidthsPx;
  const { header, repeat, rowsAfterRepeat } = block;
  if (rowsAfterRepeat !== undefined && repeat === undefined) {
    report(ctx, `${path}.rowsAfterRepeat`, "invalid_table", {
      problem: "rowsAfterRepeat needs a repeat row to follow",
    });
  }
  reportInvalidRepeat(ctx, path, repeat);
  const rows = [
    ...(header === undefined
      ? []
      : [
          rowNode(ctx, `${path}.header`, header, {
            header: true,
            widths,
            attrs: { repeatHeader: true },
          }),
        ]),
    ...block.rows.map((row, index) =>
      rowNode(ctx, `${path}.rows.${index}`, row, { header: false, widths }),
    ),
    ...(repeat === undefined
      ? []
      : [
          rowNode(ctx, `${path}.repeat.row`, repeat.row, {
            header: false,
            widths,
            attrs: { each: repeat.each },
          }),
        ]),
    ...(rowsAfterRepeat ?? []).map((row, index) =>
      rowNode(ctx, `${path}.rowsAfterRepeat.${index}`, row, { header: false, widths }),
    ),
  ];
  const cellCounts = new Set(rows.map((row) => row.content?.length ?? 0));
  if (rows.length === 0 || cellCounts.size > 1) {
    report(ctx, path, "invalid_table", {
      problem: "needs a row and the same number of cells in every row",
    });
  }
  const tableAttrs = tableAttrsOf(block);
  return {
    type: "table",
    ...(Object.keys(tableAttrs).length === 0 ? {} : { attrs: tableAttrs }),
    content: rows,
  };
}

function frameNode(
  ctx: BuildContext,
  path: string,
  input: Extract<BlockInput, { type: "frame" }>,
): JSONContent {
  return {
    type: "documentFrame",
    attrs: {
      xMm: input.xMm,
      yMm: input.yMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      preset: input.preset ?? null,
      reserveFlow: input.reserveFlow ?? true,
    },
    content: input.blocks.map((inner, index) => blockNode(ctx, `${path}.blocks.${index}`, inner)),
  };
}

// Only the header and footer print outside the page margins, so only they can reach the paper edge.
function isBleedRegion(region: LayoutRegionName | undefined): boolean {
  return region === "header" || region === "footer";
}

function dividerNode(input: Extract<BlockInput, { type: "divider" }>): JSONContent {
  const attrs = {
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.weightPt === undefined ? {} : { weightPt: input.weightPt }),
  };
  return { type: "divider", ...(Object.keys(attrs).length === 0 ? {} : { attrs }) };
}

function imageNode(
  ctx: BuildContext,
  path: string,
  input: Extract<BlockInput, { type: "image" }>,
): JSONContent {
  if (!isDocumentResourceKey(input.resource)) {
    report(ctx, `${path}.resource`, "invalid_resource_key", { resource: input.resource });
  }
  if (input.bleed === true && !(ctx.kind === "pdf-layout" && isBleedRegion(ctx.region))) {
    report(ctx, `${path}.bleed`, "bleed_not_allowed", { kind: ctx.kind });
  }
  return {
    type: "resource",
    attrs: {
      resource: input.resource,
      alt: input.alt ?? null,
      ...(input.widthMm === undefined ? {} : { widthMm: input.widthMm }),
      ...(input.align === undefined ? {} : { align: input.align }),
      ...(input.bleed === true ? { bleed: true } : {}),
    },
  };
}

function buttonNode(
  ctx: BuildContext,
  path: string,
  input: Extract<BlockInput, { type: "button" }>,
): JSONContent {
  if (!isDocumentPlaceholderHref(input.href)) {
    report(ctx, `${path}.href`, "invalid_button_href", { href: input.href });
  }
  return {
    type: "button",
    attrs: { href: input.href },
    content: lineToContent(singleLine(input.text)),
  };
}

export function blockNode(ctx: BuildContext, path: string, input: BlockInput): JSONContent {
  if (!isBlockTypeAllowed(input.type, ctx.kind)) {
    report(ctx, `${path}.type`, "block_not_allowed", { type: input.type, kind: ctx.kind });
  }
  switch (input.type) {
    case "paragraph":
      return textBlockNode(ctx, path, "paragraph", input, input);
    case "heading":
      return textBlockNode(ctx, path, "heading", input, input, input.level);
    case "list":
      return listNode(ctx, path, input);
    case "table":
      return tableNode(ctx, path, input);
    case "frame":
      return frameNode(ctx, path, input);
    case "image":
      return imageNode(ctx, path, input);
    case "button":
      return buttonNode(ctx, path, input);
    case "divider":
      return dividerNode(input);
    case "pageBreak":
      return { type: input.type };
  }
}

const PRINT_ATTRIBUTES = [
  "lineHeight",
  "spaceBeforePt",
  "spaceAfterPt",
  "background",
  "colwidth",
  "borders",
  "cellPaddingMm",
  "lineAbove",
  "lineBelow",
] as const;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

// An image's bleed defaults to false, so a present attribute alone says nothing there.
function hasPrintOnlyBoxAttributes(node: JSONContent): boolean {
  const attrs = node.attrs;
  if (node.type === "resource") {
    return (
      attrs?.["bleed"] === true || isPresent(attrs?.["widthMm"]) || isPresent(attrs?.["align"])
    );
  }
  if (node.type === "table") return isPresent(attrs?.["widthMm"]) || isPresent(attrs?.["align"]);
  return node.type === "divider" && (isPresent(attrs?.["color"]) || isPresent(attrs?.["weightPt"]));
}

// Frames are refused as blocks, so only the styling that would ride along in other blocks counts here.
export function usesPrintStyling(node: JSONContent): boolean {
  if (node.marks?.some((mark) => mark.type === "documentTextStyle")) return true;
  if (PRINT_ATTRIBUTES.some((name) => isPresent(node.attrs?.[name]))) return true;
  if (hasPrintOnlyBoxAttributes(node)) return true;
  return (node.content ?? []).some(usesPrintStyling);
}

// Only a PDF applies print styling; a mail would keep it through the rebuild and the sanitizer refuses it on write.
export function refusePrintStyling(
  kind: DocumentOpsKind,
  node: JSONContent,
  path: string,
): FieldIssue | null {
  return kind === "mail" && usesPrintStyling(node)
    ? patchIssue(path, "print_style_not_allowed", { kind })
    : null;
}

const TEXT_BLOCK_NODE_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading"]);
const INLINE_NODE_TYPES: ReadonlySet<string> = new Set(["text", "variable"]);

function mergeTextStyleMark(node: JSONContent, style: TextStyle): JSONContent {
  const existing = node.marks?.find((mark) => mark.type === "documentTextStyle");
  const merged = {
    color: null,
    font: null,
    sizePt: null,
    ...existing?.attrs,
    ...definedStyle(style),
  };
  return {
    ...node,
    marks: [
      ...(node.marks ?? []).filter((mark) => mark.type !== "documentTextStyle"),
      { type: "documentTextStyle", attrs: merged },
    ],
  };
}

function applyTextStyle(node: JSONContent, style: TextStyle): JSONContent {
  if (INLINE_NODE_TYPES.has(node.type ?? "")) return mergeTextStyleMark(node, style);
  return node.content === undefined
    ? node
    : { ...node, content: node.content.map((child) => applyTextStyle(child, style)) };
}

function applyBlockAttributes(node: JSONContent, attrs: Record<string, unknown>): JSONContent {
  if (TEXT_BLOCK_NODE_TYPES.has(node.type ?? "")) {
    return { ...node, attrs: { ...node.attrs, ...attrs } };
  }
  return node.content === undefined
    ? node
    : { ...node, content: node.content.map((child) => applyBlockAttributes(child, attrs)) };
}

export const FORMATTABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
]);

// Applies the given format to a paragraph, heading or list, keeping everything it does not mention.
export function formatNode(
  ctx: BuildContext,
  path: string,
  node: JSONContent,
  format: TextFormat,
): JSONContent {
  const attrs = formatAttributes(ctx, path, format);
  const withAttrs = Object.keys(attrs).length === 0 ? node : applyBlockAttributes(node, attrs);
  return format.textStyle === undefined ? withAttrs : applyTextStyle(withAttrs, format.textStyle);
}
