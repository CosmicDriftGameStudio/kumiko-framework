import type { NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  collectSnapTargets,
  FRAME_HANDLES,
  type FrameHandle,
  type FrameTagKind,
  frameAttributesOf,
  frameTagKind,
  moveFrameBox,
  type PageEdgesMm,
  resizeFrameBox,
  snapFrameBox,
} from "./document-frame-control.ts";
import { type DocumentFrameBox, documentFrameCss } from "./document-style-css.ts";

export type FrameViewLabels = Readonly<Record<FrameTagKind, string>>;

const PAPER_SELECTOR = "[data-document-paper]";
const PAPER_WIDTH_ATTRIBUTE = "data-paper-width-mm";
const PAPER_MARGIN_ATTRIBUTES = {
  left: "data-paper-margin-left-mm",
  right: "data-paper-margin-right-mm",
  top: "data-paper-margin-top-mm",
} as const;
const GUIDE_CLASS = "pointer-events-none absolute z-30 bg-primary";

// Frame states are driven by the data-frame-selected attribute a decoration puts on the frame, so
// a cursor inside the frame and a selected frame look the same as the side panel does.
const FRAME_CLASS =
  "group z-10 border border-dashed border-muted-foreground/50 bg-card data-[frame-selected]:border-[1.5px] data-[frame-selected]:border-solid data-[frame-selected]:border-primary";
const TAG_CLASS =
  "absolute -top-5 left-0 z-20 flex cursor-move select-none items-center whitespace-nowrap rounded-t bg-muted-foreground px-1.5 text-[10px] text-primary-foreground group-data-[frame-selected]:bg-primary";
const TINT_CLASS =
  "pointer-events-none absolute inset-0 hidden bg-primary/5 group-data-[frame-selected]:block";
const HANDLE_BASE_CLASS =
  "absolute z-20 hidden h-[7px] w-[7px] border-[1.5px] border-primary bg-background group-data-[frame-selected]:block";

const HANDLE_CLASS: Readonly<Record<FrameHandle, string>> = {
  nw: "-left-1 -top-1 cursor-nwse-resize",
  n: "-top-1 left-[calc(50%-3.5px)] cursor-ns-resize",
  ne: "-right-1 -top-1 cursor-nesw-resize",
  e: "-right-1 top-[calc(50%-3.5px)] cursor-ew-resize",
  se: "-bottom-1 -right-1 cursor-nwse-resize",
  s: "-bottom-1 left-[calc(50%-3.5px)] cursor-ns-resize",
  sw: "-bottom-1 -left-1 cursor-nesw-resize",
  w: "-left-1 top-[calc(50%-3.5px)] cursor-ew-resize",
};

function boxOf(node: ProseMirrorNode): DocumentFrameBox {
  const { xMm, yMm, widthMm, heightMm } = frameAttributesOf(node);
  return { xMm, yMm, widthMm, heightMm };
}

function mmPerPixelOf(element: HTMLElement): number | null {
  const paper = element.closest(PAPER_SELECTOR);
  if (paper === null) return null;
  const widthMm = Number(paper.getAttribute(PAPER_WIDTH_ATTRIBUTE));
  const widthPx = paper.getBoundingClientRect().width;
  return widthMm > 0 && widthPx > 0 ? widthMm / widthPx : null;
}

function numberAttribute(element: Element, name: string): number {
  return Number(element.getAttribute(name));
}

function pageEdgesOf(paper: Element): PageEdgesMm {
  return {
    widthMm: numberAttribute(paper, PAPER_WIDTH_ATTRIBUTE),
    marginLeftMm: numberAttribute(paper, PAPER_MARGIN_ATTRIBUTES.left),
    marginRightMm: numberAttribute(paper, PAPER_MARGIN_ATTRIBUTES.right),
    marginTopMm: numberAttribute(paper, PAPER_MARGIN_ATTRIBUTES.top),
  };
}

function guideElement(paper: Element, axis: "x" | "y", mm: number): HTMLDivElement {
  const guide = paper.ownerDocument.createElement("div");
  guide.className = GUIDE_CLASS;
  guide.setAttribute("data-testid", "document-frame-guide");
  const position = `calc(${mm} * var(--paper-mm))`;
  if (axis === "x") {
    guide.classList.add("top-0", "bottom-0", "w-px");
    guide.style.left = position;
  } else {
    guide.classList.add("left-0", "right-0", "h-px");
    guide.style.top = position;
  }
  paper.append(guide);
  return guide;
}

function createDiv(className: string, testId: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("data-testid", testId);
  element.contentEditable = "false";
  return element;
}

export function createFrameView(labels: FrameViewLabels): NodeViewRenderer {
  return ({ node: initialNode, editor, getPos }) => {
    let node = initialNode;
    const dom = document.createElement("div");
    dom.className = FRAME_CLASS;
    dom.setAttribute("data-testid", "document-frame");
    const tag = createDiv(TAG_CLASS, "document-frame-move");
    const tint = createDiv(TINT_CLASS, "document-frame-tint");
    const contentDOM = document.createElement("div");
    contentDOM.className = "h-full overflow-hidden [&>:last-child]:mb-0";
    dom.append(tint, tag, contentDOM);

    const applyBox = (box: DocumentFrameBox): void => {
      dom.style.cssText = documentFrameCss(box);
      // The tag and handles sit outside the box; only the content is clipped.
      dom.style.overflow = "visible";
    };
    const render = (): void => {
      const attrs = frameAttributesOf(node);
      applyBox(boxOf(node));
      dom.setAttribute("data-frame-preset", attrs.preset ?? "");
      tag.textContent = labels[frameTagKind(attrs.preset, attrs.yMm)];
    };

    let cancelGesture: (() => void) | null = null;
    const startGesture = (event: PointerEvent, handle: FrameHandle | "move"): void => {
      const mmPerPixel = mmPerPixelOf(dom);
      const pos = getPos();
      if (mmPerPixel === null || pos === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      editor.commands.setNodeSelection(pos);
      const start = boxOf(node);
      let preview = start;
      const paper = dom.closest(PAPER_SELECTOR);
      const targets =
        paper === null ? null : collectSnapTargets(editor.state.doc, pos, pageEdgesOf(paper));
      let guides: HTMLDivElement[] = [];
      const clearGuides = (): void => {
        for (const guide of guides) guide.remove();
        guides = [];
      };
      const onMove = (move: PointerEvent): void => {
        const dx = (move.clientX - event.clientX) * mmPerPixel;
        const dy = (move.clientY - event.clientY) * mmPerPixel;
        const raw =
          handle === "move" ? moveFrameBox(start, dx, dy) : resizeFrameBox(start, handle, dx, dy);
        clearGuides();
        if (paper === null || targets === null || move.altKey) {
          preview = raw;
        } else {
          const snapped = snapFrameBox(raw, handle, targets);
          preview = snapped.box;
          if (snapped.guides.xMm !== null)
            guides.push(guideElement(paper, "x", snapped.guides.xMm));
          if (snapped.guides.yMm !== null)
            guides.push(guideElement(paper, "y", snapped.guides.yMm));
        }
        applyBox(preview);
      };
      const stop = (): void => {
        clearGuides();
        dom.ownerDocument.removeEventListener("pointermove", onMove);
        dom.ownerDocument.removeEventListener("pointerup", onUp);
        cancelGesture = null;
      };
      const onUp = (): void => {
        stop();
        const current = getPos();
        if (current === undefined) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(current, undefined, { ...node.attrs, ...preview }),
        );
      };
      dom.ownerDocument.addEventListener("pointermove", onMove);
      dom.ownerDocument.addEventListener("pointerup", onUp);
      cancelGesture = stop;
    };

    tag.addEventListener("pointerdown", (event) => startGesture(event, "move"));
    if (editor.isEditable) {
      for (const handle of FRAME_HANDLES) {
        const element = createDiv(
          `${HANDLE_BASE_CLASS} ${HANDLE_CLASS[handle]}`,
          `document-frame-handle-${handle}`,
        );
        element.addEventListener("pointerdown", (event) => startGesture(event, handle));
        dom.append(element);
      }
    }
    render();

    return {
      dom,
      contentDOM,
      update: (updated) => {
        if (updated.type !== node.type) return false;
        node = updated;
        render();
        return true;
      },
      ignoreMutation: (mutation) =>
        mutation.type === "selection" ? false : !contentDOM.contains(mutation.target),
      stopEvent: (event) => event.target instanceof Node && !contentDOM.contains(event.target),
      destroy: () => cancelGesture?.(),
    };
  };
}
