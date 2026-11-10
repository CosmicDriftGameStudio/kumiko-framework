import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { getSchema, type JSONContent } from "@tiptap/core";
import * as z from "zod";
import {
  type BlockInput,
  type BuildContext,
  blockFormatSchema,
  blockInputSchema,
  blockNode,
  countBlocks,
  FORMATTABLE_NODE_TYPES,
  formatNode,
  MAX_BODY_BLOCKS,
  patchIssue,
  refusePrintStyling,
} from "./document-op-blocks.ts";
import { toVariableDef } from "./template-validation.ts";
import type { DocumentOpsKind } from "./web/constants.ts";
import {
  documentExtensions,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./web/document-schema.ts";
import { contentToLine, lineToContent, singleLine } from "./web/placeholder-text.ts";

export const MAX_DOCUMENT_OPS = 50;

// Assigning these keys would reach the prototype of the meta object.
const FORBIDDEN_META_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export type DocumentBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "table"
  | "repeat"
  | "frame"
  | "image"
  | "button"
  | "divider"
  | "pageBreak"
  | "steps";

export type DocumentBlock = {
  readonly id: string;
  readonly type: DocumentBlockType;
  /** Inline content with `{{name}}` for placeholders; containers list one line per text block. */
  readonly text?: string;
  readonly level?: number;
  readonly align?: string;
  readonly showIf?: string;
  readonly resource?: string;
  readonly alt?: string;
  readonly href?: string;
  readonly each?: string;
  readonly frame?: FrameBox;
};

export type FrameBox = {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly preset?: string;
};

const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "button"]);

function blockTypeOf(node: JSONContent): DocumentBlockType | null {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "button":
    case "divider":
    case "pageBreak":
    case "steps":
      return node.type;
    case "bulletList":
    case "orderedList":
      return "list";
    case "table":
      return eachOf(node) === undefined ? "table" : "repeat";
    case "resource":
      return "image";
    case "documentFrame":
      return "frame";
    default:
      return null;
  }
}

function stringAttr(node: JSONContent, name: string): string | undefined {
  const value: unknown = node.attrs?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function eachOf(table: JSONContent): string | undefined {
  for (const row of table.content ?? []) {
    const each = stringAttr(row, "each");
    if (each !== undefined) return each;
  }
  return undefined;
}

function textLinesOf(node: JSONContent): string[] {
  if (TEXT_BLOCK_TYPES.has(node.type ?? "")) return [contentToLine(node.content)];
  return (node.content ?? []).flatMap(textLinesOf);
}

type MutableBlock = { -readonly [K in keyof DocumentBlock]: DocumentBlock[K] };

const NON_TEXT_BLOCK_TYPES: ReadonlySet<DocumentBlockType> = new Set([
  "image",
  "divider",
  "pageBreak",
  "steps",
]);

function setOptionalAttrs(block: MutableBlock, node: JSONContent): void {
  const align = stringAttr(node, "textAlign");
  if (align !== undefined) block.align = align;
  const showIf = stringAttr(node, "showIf");
  if (showIf !== undefined) block.showIf = showIf;
}

function setTypeSpecificAttrs(block: MutableBlock, node: JSONContent): void {
  const level: unknown = node.attrs?.["level"];
  if (block.type === "heading" && typeof level === "number") block.level = level;
  const resource = stringAttr(node, "resource");
  if (block.type === "image" && resource !== undefined) block.resource = resource;
  const alt = stringAttr(node, "alt");
  if (block.type === "image" && alt !== undefined) block.alt = alt;
  const href = stringAttr(node, "href");
  if (block.type === "button" && href !== undefined) block.href = href;
  const each = eachOf(node);
  if (block.type === "repeat" && each !== undefined) block.each = each;
  if (block.type === "frame") block.frame = frameBoxOf(node);
}

function numberAttr(node: JSONContent, name: string): number {
  const value: unknown = node.attrs?.[name];
  return typeof value === "number" ? value : 0;
}

function frameBoxOf(node: JSONContent): FrameBox {
  const preset = stringAttr(node, "preset");
  return {
    xMm: numberAttr(node, "xMm"),
    yMm: numberAttr(node, "yMm"),
    widthMm: numberAttr(node, "widthMm"),
    heightMm: numberAttr(node, "heightMm"),
    ...(preset === undefined ? {} : { preset }),
  };
}

function blockOf(node: JSONContent, id: string): DocumentBlock | null {
  const type = blockTypeOf(node);
  if (type === null) return null;
  const block: MutableBlock = { id, type };
  if (!NON_TEXT_BLOCK_TYPES.has(type)) block.text = textLinesOf(node).join("\n");
  setOptionalAttrs(block, node);
  setTypeSpecificAttrs(block, node);
  return block;
}

export function documentBlockId(index: number): string {
  return `b${index}`;
}

export function documentBlocksOf(doc: JSONContent): DocumentBlock[] {
  return (doc.content ?? []).flatMap((node, index) => blockOf(node, documentBlockId(index)) ?? []);
}

const blockIdSchema = z.string().min(1).max(20);

export type { BlockInput };

export const documentOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("insertBlock"),
    after: blockIdSchema.nullable(),
    block: blockInputSchema,
  }),
  z.object({
    op: z.literal("replaceText"),
    blockId: blockIdSchema,
    find: z.string().min(1).max(2000),
    replace: z.string().max(2000),
  }),
  z.object({ op: z.literal("removeBlock"), blockId: blockIdSchema }),
  z.object({
    op: z.literal("replaceBody"),
    blocks: z.array(blockInputSchema).min(1).max(MAX_BODY_BLOCKS),
  }),
  blockFormatSchema.extend({ op: z.literal("formatBlock"), blockId: blockIdSchema }),
  z.object({
    op: z.literal("setResource"),
    blockId: blockIdSchema,
    resource: z.string().min(1).max(200),
    alt: z.string().max(500).nullable().optional(),
  }),
  z.object({ op: z.literal("setMeta"), meta: z.record(z.string(), z.unknown()) }),
  z.object({
    op: z.literal("setVariable"),
    name: z.string().min(1).max(100),
    definition: z.unknown().nullable(),
  }),
]);

export const documentOpsSchema = z.array(documentOpSchema).min(1).max(MAX_DOCUMENT_OPS);

export type DocumentOp = z.infer<typeof documentOpSchema>;

export type DocumentOpsInput = {
  readonly doc: JSONContent;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly kind: DocumentOpsKind;
  readonly ops: readonly DocumentOp[];
};

export type DocumentOpsResult =
  | {
      readonly ok: true;
      readonly doc: JSONContent;
      readonly meta: Record<string, unknown>;
      readonly variableSchema: Record<string, unknown>;
    }
  | { readonly ok: false; readonly issues: FieldIssue[] };

type Entry = { node: JSONContent; removed: boolean; readonly insertedAfter: JSONContent[] };

function textNodesIn(nodes: readonly JSONContent[]): JSONContent[] {
  return nodes.flatMap((node) => (node.type === "text" ? [node] : textNodesIn(node.content ?? [])));
}

function occurrencesOf(text: string, find: string): number {
  return text.split(find).length - 1;
}

function replacementNodes(textNode: JSONContent, find: string, replace: string): JSONContent[] {
  const text = textNode.text ?? "";
  const at = text.indexOf(find);
  const withMarks = (node: JSONContent): JSONContent =>
    node.type === "text" && textNode.marks !== undefined
      ? { ...node, marks: textNode.marks }
      : node;
  const before = text.slice(0, at);
  const after = text.slice(at + find.length);
  return [
    ...(before === "" ? [] : [{ ...textNode, text: before }]),
    ...lineToContent(singleLine(replace)).map(withMarks),
    ...(after === "" ? [] : [{ ...textNode, text: after }]),
  ];
}

function replaceInContent(
  content: readonly JSONContent[],
  find: string,
  replace: string,
): JSONContent[] {
  return content.flatMap((node) => {
    if (node.type === "text") {
      return (node.text ?? "").includes(find) ? replacementNodes(node, find, replace) : [node];
    }
    return [
      node.content === undefined
        ? node
        : { ...node, content: replaceInContent(node.content, find, replace) },
    ];
  });
}

let cachedSchema: ReturnType<typeof getSchema> | null = null;

function documentSchema(): ReturnType<typeof getSchema> {
  cachedSchema ??= getSchema(documentExtensions);
  return cachedSchema;
}

function isValidDocument(doc: JSONContent): boolean {
  try {
    documentSchema().nodeFromJSON(doc).check();
    return true;
  } catch {
    return false;
  }
}

type OpState = {
  readonly kind: DocumentOpsKind;
  replacement: JSONContent[] | null;
  readonly entries: Map<string, Entry>;
  readonly insertedAtStart: JSONContent[];
  readonly meta: Record<string, unknown>;
  readonly variableSchema: Record<string, unknown>;
};

type EntryLookup = { readonly entry: Entry } | { readonly issue: FieldIssue };

function lookupEntry(state: OpState, blockId: string, fieldPath: string): EntryLookup {
  const entry = state.entries.get(blockId);
  if (entry === undefined) return { issue: patchIssue(fieldPath, "unknown_block", { blockId }) };
  if (entry.removed) return { issue: patchIssue(fieldPath, "block_removed", { blockId }) };
  return { entry };
}

type InsertBlockOp = Extract<DocumentOp, { op: "insertBlock" }>;

function buildBlocks(
  state: OpState,
  blocks: readonly BlockInput[],
  pathOf: (index: number) => string,
): { readonly nodes: JSONContent[]; readonly issues: FieldIssue[] } {
  const ctx: BuildContext = { kind: state.kind, issues: [] };
  const nodes = blocks.map((block, index) => blockNode(ctx, pathOf(index), block));
  nodes.forEach((node, index) => {
    const refused = refusePrintStyling(state.kind, node, pathOf(index));
    if (refused !== null) ctx.issues.push(refused);
  });
  return { nodes, issues: ctx.issues };
}

function insertBlockOp(state: OpState, op: InsertBlockOp, path: string): FieldIssue[] {
  const anchor = op.after === null ? null : lookupEntry(state, op.after, `${path}.after`);
  if (anchor !== null && "issue" in anchor) return [anchor.issue];
  const built = buildBlocks(state, [op.block], () => `${path}.block`);
  if (built.issues.length > 0) return built.issues;
  const target = anchor === null ? state.insertedAtStart : anchor.entry.insertedAfter;
  target.push(...built.nodes);
  return [];
}

function replaceBodyOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "replaceBody" }>,
  path: string,
): FieldIssue[] {
  if (countBlocks(op.blocks) > MAX_BODY_BLOCKS) {
    return [patchIssue(`${path}.blocks`, "too_many_blocks", { max: MAX_BODY_BLOCKS })];
  }
  const built = buildBlocks(state, op.blocks, (index) => `${path}.blocks.${index}`);
  if (built.issues.length > 0) return built.issues;
  for (const entry of state.entries.values()) {
    entry.removed = true;
    entry.insertedAfter.length = 0;
  }
  state.insertedAtStart.length = 0;
  state.replacement = built.nodes;
  return [];
}

function formatBlockOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "formatBlock" }>,
  path: string,
): FieldIssue[] {
  const found = lookupEntry(state, op.blockId, `${path}.blockId`);
  if ("issue" in found) return [found.issue];
  const { entry } = found;
  if (op.align === undefined && op.style === undefined && op.textStyle === undefined) {
    return [patchIssue(path, "empty_format")];
  }
  if (!FORMATTABLE_NODE_TYPES.has(entry.node.type ?? "")) {
    return [
      patchIssue(`${path}.blockId`, "block_type_mismatch", {
        expected: "paragraph, heading or list",
        actual: entry.node.type ?? "unknown",
      }),
    ];
  }
  const ctx: BuildContext = { kind: state.kind, issues: [] };
  const formatted = formatNode(ctx, path, entry.node, op);
  const refused = refusePrintStyling(state.kind, formatted, path);
  if (refused !== null) ctx.issues.push(refused);
  if (ctx.issues.length > 0) return ctx.issues;
  entry.node = formatted;
  return [];
}

function removeBlockOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "removeBlock" }>,
  path: string,
): FieldIssue | null {
  const found = lookupEntry(state, op.blockId, `${path}.blockId`);
  if ("issue" in found) return found.issue;
  found.entry.removed = true;
  return null;
}

export const REPLACE_TEXT_ISSUE_CODES = {
  notFound: "text_not_found",
  spansFormatting: "text_spans_formatting",
  placeholderNotReplaceable: "placeholder_not_replaceable",
} as const;

// document-blocks shows the line across formatting runs with placeholders as {{name}},
// so a find that is visible there but lies in no single text node needs its own explanation.
function textNotMatchedCode(block: JSONContent, find: string): string {
  if (!textLinesOf(block).some((line) => line.includes(find))) {
    return REPLACE_TEXT_ISSUE_CODES.notFound;
  }
  return find.includes("{{")
    ? REPLACE_TEXT_ISSUE_CODES.placeholderNotReplaceable
    : REPLACE_TEXT_ISSUE_CODES.spansFormatting;
}

function replaceTextOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "replaceText" }>,
  path: string,
): FieldIssue | null {
  const found = lookupEntry(state, op.blockId, `${path}.blockId`);
  if ("issue" in found) return found.issue;
  const { entry } = found;
  const count = textNodesIn([entry.node]).reduce(
    (sum, node) => sum + occurrencesOf(node.text ?? "", op.find),
    0,
  );
  if (count === 0) {
    return patchIssue(`${path}.find`, textNotMatchedCode(entry.node, op.find), { find: op.find });
  }
  if (count > 1) return patchIssue(`${path}.find`, "text_ambiguous", { find: op.find, count });
  entry.node = replaceInContent([entry.node], op.find, op.replace)[0] ?? entry.node;
  return null;
}

function setResourceOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "setResource" }>,
  path: string,
): FieldIssue | null {
  const found = lookupEntry(state, op.blockId, `${path}.blockId`);
  if ("issue" in found) return found.issue;
  const { entry } = found;
  if (entry.node.type !== "resource") {
    return patchIssue(`${path}.blockId`, "block_type_mismatch", {
      expected: "image",
      actual: entry.node.type ?? "unknown",
    });
  }
  if (!isDocumentResourceKey(op.resource)) {
    return patchIssue(`${path}.resource`, "invalid_resource_key", { resource: op.resource });
  }
  const alt = op.alt === undefined ? (entry.node.attrs?.["alt"] ?? null) : op.alt;
  entry.node = { ...entry.node, attrs: { resource: op.resource, alt } };
  return null;
}

function setMetaOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "setMeta" }>,
  path: string,
): FieldIssue | null {
  const forbidden = Object.keys(op.meta).find((key) => FORBIDDEN_META_KEYS.has(key));
  if (forbidden !== undefined) {
    return patchIssue(`${path}.meta`, "invalid_meta_key", { key: forbidden });
  }
  for (const [key, value] of Object.entries(op.meta)) {
    if (value === null) delete state.meta[key];
    else state.meta[key] = value;
  }
  return null;
}

function setVariableOp(
  state: OpState,
  op: Extract<DocumentOp, { op: "setVariable" }>,
  path: string,
): FieldIssue | null {
  if (!isDocumentReferenceName(op.name)) {
    return patchIssue(`${path}.name`, "invalid_variable_name", { name: op.name });
  }
  if (op.definition === null) {
    delete state.variableSchema[op.name];
    return null;
  }
  const definition = toVariableDef(op.definition);
  if (definition === null) {
    return patchIssue(`${path}.definition`, "invalid_variable_definition", { name: op.name });
  }
  state.variableSchema[op.name] = definition;
  return null;
}

function applyOp(state: OpState, op: DocumentOp, path: string): FieldIssue[] {
  switch (op.op) {
    case "insertBlock":
      return insertBlockOp(state, op, path);
    case "replaceBody":
      return replaceBodyOp(state, op, path);
    case "formatBlock":
      return formatBlockOp(state, op, path);
    case "removeBlock":
      return singleIssue(removeBlockOp(state, op, path));
    case "replaceText":
      return singleIssue(replaceTextOp(state, op, path));
    case "setResource":
      return singleIssue(setResourceOp(state, op, path));
    case "setMeta":
      return singleIssue(setMetaOp(state, op, path));
    case "setVariable":
      return singleIssue(setVariableOp(state, op, path));
  }
}

function singleIssue(issue: FieldIssue | null): FieldIssue[] {
  return issue === null ? [] : [issue];
}

// Ops address blocks by the ids of the document as it was read, so inserted blocks are
// collected per anchor and the list is assembled once at the end.
export function applyDocumentOps(input: DocumentOpsInput): DocumentOpsResult {
  const entries = new Map<string, Entry>();
  (input.doc.content ?? []).forEach((node, index) => {
    entries.set(documentBlockId(index), {
      node: structuredClone(node),
      removed: false,
      insertedAfter: [],
    });
  });
  const state: OpState = {
    kind: input.kind,
    replacement: null,
    entries,
    insertedAtStart: [],
    meta: { ...input.meta },
    variableSchema: { ...input.variableSchema },
  };
  const issues = input.ops.flatMap((op, index) => applyOp(state, op, `ops.${index}`));
  if (issues.length > 0) return { ok: false, issues };

  const content = [
    ...state.insertedAtStart,
    ...(state.replacement ??
      [...entries.values()].flatMap((entry) =>
        entry.removed ? entry.insertedAfter : [entry.node, ...entry.insertedAfter],
      )),
  ];
  const doc: JSONContent = { ...input.doc, content };
  if (!isValidDocument(doc)) return { ok: false, issues: [patchIssue("ops", "invalid_document")] };
  return { ok: true, doc, meta: state.meta, variableSchema: state.variableSchema };
}
