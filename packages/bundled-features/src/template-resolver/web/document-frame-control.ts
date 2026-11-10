import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import { type DocumentFrameAttributes, FRAME_PRESETS } from "./document-print-style.ts";
import {
  type DocumentFrameBox,
  FRAME_FLOW_GAP_MM,
  SENDER_LINE_SIZE_PT,
} from "./document-style-css.ts";

export type DocumentFrameControl = {
  readonly attrs: DocumentFrameAttributes;
  readonly update: (patch: Partial<DocumentFrameAttributes>) => void;
  readonly remove: () => void;
  readonly senderLine: boolean;
  readonly setSenderLine: (on: boolean) => void;
  /** Variable name of the placeholder in the last paragraph, null without one. */
  readonly recipient: string | null;
  readonly setRecipient: (variableName: string | null) => void;
};

export const FRAME_NODE_NAME = "documentFrame";
export const FRAME_SELECTED_ATTRIBUTE = "data-frame-selected";
export const FRAME_STEP_MM = 0.5;
export const FRAME_MIN_SIZE_MM = 10;
export const FRAME_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type FrameHandle = (typeof FRAME_HANDLES)[number];

const TEXT_STYLE_MARK = "documentTextStyle";
const DIN_5008_FORM_A_Y_MM = 27;
const DIN_5008_FORM_B_Y_MM = 45;

const ADDRESS_FRAME_BOX: DocumentFrameBox = { xMm: 20, yMm: 45, widthMm: 85, heightMm: 45 };
const TEXT_FRAME_BOX: DocumentFrameBox = { xMm: 125, yMm: 50, widthMm: 65, heightMm: 34 };

export function roundToHalfMm(value: number): number {
  return Math.round(value / FRAME_STEP_MM) * FRAME_STEP_MM;
}

export function moveFrameBox(box: DocumentFrameBox, dxMm: number, dyMm: number): DocumentFrameBox {
  return {
    ...box,
    xMm: Math.max(0, roundToHalfMm(box.xMm + dxMm)),
    yMm: Math.max(0, roundToHalfMm(box.yMm + dyMm)),
  };
}

// The edge opposite the dragged corner stays put, so a clamp never shifts the whole frame.
export function resizeFrameBox(
  box: DocumentFrameBox,
  handle: FrameHandle,
  dxMm: number,
  dyMm: number,
): DocumentFrameBox {
  const right = box.xMm + box.widthMm;
  const bottom = box.yMm + box.heightMm;
  const movesLeft = handle === "nw" || handle === "sw" || handle === "w";
  const movesRight = handle === "ne" || handle === "se" || handle === "e";
  const movesTop = handle === "nw" || handle === "ne" || handle === "n";
  const movesBottom = handle === "sw" || handle === "se" || handle === "s";
  const left = movesLeft
    ? Math.min(Math.max(0, roundToHalfMm(box.xMm + dxMm)), right - FRAME_MIN_SIZE_MM)
    : box.xMm;
  const top = movesTop
    ? Math.min(Math.max(0, roundToHalfMm(box.yMm + dyMm)), bottom - FRAME_MIN_SIZE_MM)
    : box.yMm;
  const newRight = movesRight
    ? Math.max(left + FRAME_MIN_SIZE_MM, roundToHalfMm(right + dxMm))
    : right;
  const newBottom = movesBottom
    ? Math.max(top + FRAME_MIN_SIZE_MM, roundToHalfMm(bottom + dyMm))
    : bottom;
  return { xMm: left, yMm: top, widthMm: newRight - left, heightMm: newBottom - top };
}

export const FRAME_SNAP_TOLERANCE_MM = 1.5;

export type FrameSnapTargets = {
  readonly xLinesMm: readonly number[];
  readonly yLinesMm: readonly number[];
  readonly widthsMm: readonly number[];
  readonly heightsMm: readonly number[];
};

export type FrameGuides = { readonly xMm: number | null; readonly yMm: number | null };

type AxisMode = "move" | "low" | "high" | "none";
type AxisSnap = { readonly start: number; readonly size: number; readonly guide: number | null };

function nearestWithin(
  value: number,
  candidates: readonly number[],
  toleranceMm: number,
): number | null {
  let best: number | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= toleranceMm && (best === null || distance < Math.abs(best - value))) {
      best = candidate;
    }
  }
  return best;
}

function snapMove(
  start: number,
  size: number,
  lines: readonly number[],
  toleranceMm: number,
): AxisSnap {
  const unchanged: AxisSnap = { start, size, guide: null };
  const end = start + size;
  const leading = nearestWithin(start, lines, toleranceMm);
  const trailing = nearestWithin(end, lines, toleranceMm);
  const leadingDistance = leading === null ? Infinity : Math.abs(leading - start);
  const trailingDistance = trailing === null ? Infinity : Math.abs(trailing - end);
  if (leading !== null && leadingDistance <= trailingDistance) {
    return { start: leading, size, guide: leading };
  }
  if (trailing !== null) {
    const snappedStart = trailing - size;
    return snappedStart >= 0 ? { start: snappedStart, size, guide: trailing } : unchanged;
  }
  return unchanged;
}

// The dragged edge snaps to a line or the size to another frame's size; the fixed edge stays.
function snapResize(
  start: number,
  size: number,
  mode: "low" | "high",
  lines: readonly number[],
  sizes: readonly number[],
  toleranceMm: number,
): AxisSnap {
  const unchanged: AxisSnap = { start, size, guide: null };
  const end = start + size;
  const dragged = mode === "low" ? start : end;
  const fixed = mode === "low" ? end : start;
  const line = nearestWithin(dragged, lines, toleranceMm);
  const matchedSize = nearestWithin(size, sizes, toleranceMm);
  const lineDistance = line === null ? Infinity : Math.abs(line - dragged);
  const sizeDistance = matchedSize === null ? Infinity : Math.abs(matchedSize - size);
  const resolve = (candidateSize: number, guide: number | null): AxisSnap => {
    const candidateStart = mode === "low" ? fixed - candidateSize : start;
    return candidateSize >= FRAME_MIN_SIZE_MM && candidateStart >= 0
      ? { start: candidateStart, size: candidateSize, guide }
      : unchanged;
  };
  if (line !== null && lineDistance <= sizeDistance) {
    return resolve(mode === "low" ? fixed - line : line - fixed, line);
  }
  if (matchedSize !== null) return resolve(matchedSize, null);
  return unchanged;
}

function snapAxis(
  start: number,
  size: number,
  mode: AxisMode,
  lines: readonly number[],
  sizes: readonly number[],
  toleranceMm: number,
): AxisSnap {
  if (mode === "none") return { start, size, guide: null };
  if (mode === "move") return snapMove(start, size, lines, toleranceMm);
  return snapResize(start, size, mode, lines, sizes, toleranceMm);
}

export function snapFrameBox(
  box: DocumentFrameBox,
  gesture: FrameHandle | "move",
  targets: FrameSnapTargets,
  toleranceMm: number = FRAME_SNAP_TOLERANCE_MM,
): { readonly box: DocumentFrameBox; readonly guides: FrameGuides } {
  const xMode: AxisMode =
    gesture === "move"
      ? "move"
      : gesture.includes("w")
        ? "low"
        : gesture.includes("e")
          ? "high"
          : "none";
  const yMode: AxisMode =
    gesture === "move"
      ? "move"
      : gesture.includes("n")
        ? "low"
        : gesture.includes("s")
          ? "high"
          : "none";
  const x = snapAxis(box.xMm, box.widthMm, xMode, targets.xLinesMm, targets.widthsMm, toleranceMm);
  const y = snapAxis(
    box.yMm,
    box.heightMm,
    yMode,
    targets.yLinesMm,
    targets.heightsMm,
    toleranceMm,
  );
  return {
    box: { xMm: x.start, yMm: y.start, widthMm: x.size, heightMm: y.size },
    guides: { xMm: x.guide, yMm: y.guide },
  };
}

export type PageEdgesMm = {
  readonly marginLeftMm: number;
  readonly marginRightMm: number;
  readonly marginTopMm: number;
  readonly widthMm: number;
};

export function collectSnapTargets(
  doc: ProseMirrorNode,
  ownPos: number,
  page: PageEdgesMm,
): FrameSnapTargets {
  const xLinesMm = [page.marginLeftMm, page.widthMm - page.marginRightMm];
  const yLinesMm = [page.marginTopMm];
  const widthsMm: number[] = [];
  const heightsMm: number[] = [];
  doc.forEach((child, offset) => {
    if (child.type.name !== FRAME_NODE_NAME || offset === ownPos) return;
    const other = frameAttributesOf(child);
    xLinesMm.push(other.xMm, other.xMm + other.widthMm);
    yLinesMm.push(other.yMm, other.yMm + other.heightMm);
    widthsMm.push(other.widthMm);
    heightsMm.push(other.heightMm);
  });
  return { xLinesMm, yLinesMm, widthsMm, heightsMm };
}

export type FrameTagKind = "addressFormA" | "addressFormB" | "address" | "text";

export function frameTagKind(preset: DocumentFrameAttributes["preset"], yMm: number): FrameTagKind {
  if (preset !== "address") return "text";
  if (Math.abs(yMm - DIN_5008_FORM_A_Y_MM) < FRAME_STEP_MM) return "addressFormA";
  if (Math.abs(yMm - DIN_5008_FORM_B_Y_MM) < FRAME_STEP_MM) return "addressFormB";
  return "address";
}

export function frameFlowBottomMm(doc: ProseMirrorNode): number {
  let bottom = 0;
  doc.forEach((child) => {
    if (child.type.name !== FRAME_NODE_NAME) return;
    const attrs = frameAttributesOf(child);
    if (attrs.reserveFlow)
      bottom = Math.max(bottom, attrs.yMm + attrs.heightMm + FRAME_FLOW_GAP_MM);
  });
  return bottom;
}

function numberAttr(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function frameAttributesOf(node: ProseMirrorNode): DocumentFrameAttributes {
  const { xMm, yMm, widthMm, heightMm, preset, reserveFlow } = node.attrs;
  return {
    xMm: numberAttr(xMm),
    yMm: numberAttr(yMm),
    widthMm: numberAttr(widthMm),
    heightMm: numberAttr(heightMm),
    preset: isOneOf(FRAME_PRESETS, preset) ? preset : null,
    reserveFlow: reserveFlow !== false,
  };
}

const EMPTY_PARAGRAPH: JSONContent = { type: "paragraph" };

function senderLineParagraph(): JSONContent {
  const marks = [{ type: TEXT_STYLE_MARK, attrs: { sizePt: SENDER_LINE_SIZE_PT } }];
  return {
    type: "paragraph",
    content: [
      { type: "variable", attrs: { name: "tenantName" }, marks },
      { type: "text", text: " · ", marks },
      { type: "variable", attrs: { name: "companyAddress" }, marks },
    ],
  };
}

function frameNode(
  box: DocumentFrameBox,
  preset: DocumentFrameAttributes["preset"],
  content: JSONContent[],
  reserveFlow: boolean,
): JSONContent {
  return { type: FRAME_NODE_NAME, attrs: { ...box, preset, reserveFlow }, content };
}

export function addressFrameContent(): JSONContent {
  return frameNode(ADDRESS_FRAME_BOX, "address", [senderLineParagraph(), EMPTY_PARAGRAPH], true);
}

export function textFrameContent(): JSONContent {
  return frameNode(TEXT_FRAME_BOX, "text", [EMPTY_PARAGRAPH], false);
}

export function columnsTableContent(): JSONContent {
  return {
    type: "table",
    attrs: { borders: "none" },
    content: [
      {
        type: "tableRow",
        content: [1, 2, 3, 4].map(() => ({ type: "tableCell", content: [EMPTY_PARAGRAPH] })),
      },
    ],
  };
}

// Frames are only valid as top-level body nodes, ahead of the flowing text.
export function insertFrame(editor: Editor, frame: JSONContent): void {
  let pos = 0;
  const { doc } = editor.state;
  for (let index = 0; index < doc.childCount; index++) {
    const child = doc.child(index);
    if (child.type.name !== FRAME_NODE_NAME) break;
    pos += child.nodeSize;
  }
  editor.chain().focus().insertContentAt(pos, frame).setNodeSelection(pos).run();
}

export type FrameLocation = { readonly pos: number; readonly node: ProseMirrorNode };

export function frameLocationOf(selection: Selection): FrameLocation | null {
  const { $from, from, to } = selection;
  const after = $from.nodeAfter;
  if (after?.type.name === FRAME_NODE_NAME && from + after.nodeSize === to) {
    return { pos: from, node: after };
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === FRAME_NODE_NAME) return { pos: $from.before(depth), node };
  }
  return null;
}

export function isSenderLine(paragraph: ProseMirrorNode | null | undefined): boolean {
  if (paragraph === null || paragraph === undefined) return false;
  if (paragraph.type.name !== "paragraph" || paragraph.childCount === 0) return false;
  let everyChildSmall = true;
  paragraph.forEach((child) => {
    const small = child.marks.some(
      (mark) => mark.type.name === TEXT_STYLE_MARK && mark.attrs["sizePt"] === SENDER_LINE_SIZE_PT,
    );
    if (!small) everyChildSmall = false;
  });
  return everyChildSmall;
}

function recipientOf(frame: ProseMirrorNode): string | null {
  const last = frame.lastChild;
  if (last === null || last.type.name !== "paragraph") return null;
  if (frame.childCount === 1 && isSenderLine(last)) return null;
  let name: string | null = null;
  last.forEach((child) => {
    const value: unknown = child.attrs["name"];
    if (name === null && child.type.name === "variable" && typeof value === "string") name = value;
  });
  return name;
}

export function buildFrameControl(editor: Editor, location: FrameLocation): DocumentFrameControl {
  const { pos } = location;
  const currentFrame = (): ProseMirrorNode | null => {
    const node = editor.state.doc.nodeAt(pos);
    return node !== null && node.type.name === FRAME_NODE_NAME ? node : null;
  };
  return {
    attrs: frameAttributesOf(location.node),
    update: (patch) => {
      const frame = currentFrame();
      if (frame === null) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...frame.attrs, ...patch }),
      );
    },
    remove: () => {
      const frame = currentFrame();
      if (frame === null) return;
      editor.view.dispatch(editor.state.tr.delete(pos, pos + frame.nodeSize));
    },
    senderLine: isSenderLine(location.node.firstChild),
    setSenderLine: (on) => {
      const frame = currentFrame();
      const first = frame?.firstChild;
      if (frame === null || first === null || first === undefined) return;
      const present = isSenderLine(first);
      const { tr, schema } = editor.state;
      if (on && !present) {
        tr.insert(pos + 1, schema.nodeFromJSON(senderLineParagraph()));
      } else if (!on && present) {
        const end = pos + 1 + first.nodeSize;
        if (frame.childCount === 1)
          tr.replaceWith(pos + 1, end, schema.nodeFromJSON(EMPTY_PARAGRAPH));
        else tr.delete(pos + 1, end);
      } else return;
      editor.view.dispatch(tr);
    },
    recipient: recipientOf(location.node),
    setRecipient: (variableName) => {
      const frame = currentFrame();
      const last = frame?.lastChild;
      if (frame === null || last === null || last === undefined) return;
      const { tr, schema } = editor.state;
      const variable =
        variableName === null ? null : schema.nodes["variable"]?.create({ name: variableName });
      const frameEnd = pos + frame.nodeSize - 1;
      const lastIsRecipient =
        last.type.name === "paragraph" && !(frame.childCount === 1 && isSenderLine(last));
      if (!lastIsRecipient) {
        const paragraph = schema.nodes["paragraph"]?.create(null, variable ?? undefined);
        if (paragraph === undefined) return;
        tr.insert(frameEnd, paragraph);
      } else {
        const from = frameEnd - last.nodeSize + 1;
        const to = frameEnd - 1;
        if (variable === null || variable === undefined) tr.delete(from, to);
        else tr.replaceWith(from, to, variable);
      }
      editor.view.dispatch(tr);
    },
  };
}
