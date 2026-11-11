import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import type { ReactNode } from "react";
import { DOCUMENT_BLOCK_ATTRIBUTE } from "./document-editor-extensions.ts";
import {
  DIVIDER_WEIGHT_PT_RANGE,
  DOCUMENT_IMAGE_ALIGNMENTS,
  IMAGE_WIDTH_MM_RANGE,
} from "./document-print-style.ts";
import { DOCUMENT_DATE_STYLES } from "./document-schema.ts";
import type { TiptapContext } from "./document-tiptap-context.ts";
import {
  buttonTargetLabel,
  type DividerBlock,
  findRepeatTable,
  type ResourceBlock,
  type SelectedBlock,
  toggleRepeatHeader,
  type VariableBlock,
} from "./document-tiptap-helpers.ts";
import { colorPicker, renderNumberField } from "./document-tiptap-toolbar-groups.tsx";

// The bubble menu registers its plugin once per mount, so a rebuilt editor needs a fresh mount.
const editorMountKeys = new WeakMap<Editor, number>();
let lastMountKey = 0;
function mountKeyOf(editor: Editor): number {
  const known = editorMountKeys.get(editor);
  if (known !== undefined) return known;
  lastMountKey += 1;
  const created = lastMountKey;
  editorMountKeys.set(editor, created);
  return created;
}

// Board .hb: a small bar that straddles the block's top frame line on the right; above a table it sits fully
// outside so the header row stays readable.
const BUBBLE_BAR_CLASS =
  "flex w-max items-center gap-1 rounded border border-input bg-popover p-px text-xs [&_button]:h-5 [&_button]:px-1.5 [&_button]:text-[10px]";

function bubbleOffset(editor: Editor): (args: { rects: { floating: { height: number } } }) => {
  mainAxis: number;
  crossAxis: number;
} {
  return ({ rects }) => ({
    mainAxis: findRepeatTable(editor) !== null ? 2 : -rects.floating.height / 2,
    crossAxis: -8,
  });
}

const BUBBLE_MENU_PLUGIN_KEY = "documentBlockOptions";

// The options bar belongs to the block frame, not to the caret inside it.
function selectedBlockReference(editor: Editor): {
  getBoundingClientRect: () => DOMRect;
  getClientRects: () => DOMRect[];
  contextElement: Element;
} | null {
  const { selection } = editor.state;
  // A selected leaf (divider) is its own reference; domAtPos would point at its parent.
  const selectedNode =
    selection instanceof NodeSelection ? editor.view.nodeDOM(selection.from) : null;
  const { node } = editor.view.domAtPos(selection.from);
  const start =
    selectedNode instanceof Element
      ? selectedNode
      : node instanceof Element
        ? node
        : node.parentElement;
  const block =
    selectedNode instanceof Element
      ? selectedNode
      : start?.closest(`[${DOCUMENT_BLOCK_ATTRIBUTE}], table`);
  if (block === null || block === undefined) return null;
  return {
    getBoundingClientRect: () => block.getBoundingClientRect(),
    getClientRects: () => [block.getBoundingClientRect()],
    contextElement: block,
  };
}

// The bubble is first measured before React has filled it, so it sits at the wrong place until a second pass.
function repositionBubble(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_MENU_PLUGIN_KEY, "updatePosition"));
}

function repeatBarLabelOf(c: TiptapContext): string {
  const { t, repeatListLabel } = c;
  return repeatListLabel === undefined
    ? t("template-resolver.documentEditor.repeat")
    : t("template-resolver.documentEditor.repeatBarList", { list: repeatListLabel });
}

// The print attributes of the selected block; an empty field removes the attribute again.
function setBlockAttributes(
  editor: Editor,
  nodeName: "resource" | "divider",
  attributes: Readonly<Record<string, unknown>>,
): void {
  editor.chain().focus().updateAttributes(nodeName, attributes).run();
}

function renderImagePrintControls(c: TiptapContext, selectedBlock: ResourceBlock): ReactNode {
  const { t, Button, editor } = c;
  return (
    <>
      {renderNumberField(c, {
        id: "document-image-width",
        label: t("documentDesigner.editor.imageWidth"),
        value: selectedBlock.widthMm,
        range: IMAGE_WIDTH_MM_RANGE,
        onChange: (widthMm) => setBlockAttributes(editor, "resource", { widthMm }),
      })}
      {DOCUMENT_IMAGE_ALIGNMENTS.map((align) => (
        <Button
          key={align}
          type="button"
          size="sm"
          variant="secondary"
          pressed={selectedBlock.align === align}
          testId={`document-image-align-${align}`}
          onClick={() =>
            setBlockAttributes(editor, "resource", {
              align: selectedBlock.align === align ? null : align,
            })
          }
        >
          {t(`documentDesigner.editor.imageAlign.${align}`)}
        </Button>
      ))}
    </>
  );
}

function renderDividerControls(c: TiptapContext, selectedBlock: DividerBlock): ReactNode {
  const { t, editor } = c;
  return (
    <>
      {colorPicker(
        c,
        "document-divider-color",
        t("documentDesigner.editor.dividerColor"),
        selectedBlock.color,
        (color) => setBlockAttributes(editor, "divider", { color }),
      )}
      {renderNumberField(c, {
        id: "document-divider-weight",
        label: t("documentDesigner.editor.dividerWeight"),
        value: selectedBlock.weightPt,
        range: DIVIDER_WEIGHT_PT_RANGE,
        onChange: (weightPt) => setBlockAttributes(editor, "divider", { weightPt }),
      })}
    </>
  );
}

function renderDateStyleControls(c: TiptapContext, selectedBlock: VariableBlock): ReactNode {
  const { t, Button, editor } = c;
  return (
    <>
      <span className="text-[10px] text-muted-foreground">
        {t("documentDesigner.editor.dateFormat")}
      </span>
      {DOCUMENT_DATE_STYLES.map((style) => (
        <Button
          key={style}
          type="button"
          size="sm"
          variant="secondary"
          pressed={(selectedBlock.dateStyle ?? "long") === style}
          disabled={c.readOnly}
          testId={`document-date-style-${style}`}
          onClick={() => {
            editor
              .chain()
              .focus()
              .updateAttributes("variable", { dateStyle: style === "long" ? null : style })
              .run();
          }}
        >
          {t(`documentDesigner.editor.dateFormat.${style}`)}
        </Button>
      ))}
    </>
  );
}

function blockOptionsTitle(c: TiptapContext, selectedBlock: SelectedBlock): ReactNode {
  const { t } = c;
  if (selectedBlock.type === "variable") {
    return (
      <span className="px-1.5 text-[10px] text-muted-foreground">
        {t("documentDesigner.editor.placeholderTitle")}
        {": "}
        <strong>{c.variableLabels[selectedBlock.detail] ?? selectedBlock.detail}</strong>
      </span>
    );
  }
  if (selectedBlock.type === "divider") {
    return (
      <span className="px-1.5 text-[10px] text-muted-foreground">
        {t("documentDesigner.editor.divider")}
      </span>
    );
  }
  return (
    <span className="px-1.5 text-[10px] text-muted-foreground">
      {selectedBlock.type === "resource"
        ? t("template-resolver.documentEditor.resourceKey")
        : t("template-resolver.documentEditor.buttonTarget")}
      {": "}
      {selectedBlock.type === "button" ? (
        <strong>{buttonTargetLabel(selectedBlock.detail, c.variableLabels)}</strong>
      ) : (
        <code>{selectedBlock.detail}</code>
      )}
    </span>
  );
}

function renderBlockOptionsBar(c: TiptapContext, selectedBlock: SelectedBlock): ReactNode {
  const { t, Button, editor } = c;
  return (
    <div className={BUBBLE_BAR_CLASS} data-testid="document-block-options">
      {blockOptionsTitle(c, selectedBlock)}
      {selectedBlock.type === "resource" &&
        c.print !== "none" &&
        renderImagePrintControls(c, selectedBlock)}
      {selectedBlock.type === "divider" && renderDividerControls(c, selectedBlock)}
      {selectedBlock.type === "variable" && renderDateStyleControls(c, selectedBlock)}
      {selectedBlock.type === "resource" && c.hosted && c.print === "flow" && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          pressed={selectedBlock.bleed}
          testId="document-image-bleed"
          onClick={() => {
            editor
              .chain()
              .focus()
              .updateAttributes("resource", { bleed: !selectedBlock.bleed })
              .run();
          }}
        >
          {t("documentDesigner.editor.imageBleed")}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="danger-ghost"
        onClick={() => {
          editor.chain().focus().deleteNode(selectedBlock.type).run();
        }}
      >
        {t("template-resolver.documentEditor.removeBlock")}
      </Button>
    </div>
  );
}

function renderBubbleRepeatBar(c: TiptapContext): ReactNode {
  const { t, Button, editor } = c;
  const repeatTable = c.activeState?.repeatTable ?? null;
  return (
    repeatTable !== null &&
    c.print === "none" && (
      <div data-testid="document-repeat-bar" className={BUBBLE_BAR_CLASS}>
        <span className="px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {repeatBarLabelOf(c)}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          pressed={repeatTable.headerRepeats}
          onClick={() => toggleRepeatHeader(editor)}
        >
          {t("template-resolver.documentEditor.repeatHeader")}
        </Button>
      </div>
    )
  );
}

export function renderBubbleMenu(c: TiptapContext): ReactNode {
  const { editor } = c;
  const selectedBlock = c.activeState?.selectedBlock ?? null;
  return (
    <BubbleMenu
      key={mountKeyOf(editor)}
      pluginKey={BUBBLE_MENU_PLUGIN_KEY}
      editor={editor}
      options={{
        strategy: "fixed",
        placement: selectedBlock?.type === "resource" ? "top-start" : "top-end",
        offset: bubbleOffset(editor),
        scrollTarget: c.canvasScroller ?? window,
        onShow: () => requestAnimationFrame(() => repositionBubble(editor)),
      }}
      getReferencedVirtualElement={() => selectedBlockReference(editor)}
      shouldShow={({ editor: e, element }) =>
        // A leading image is selected by default; the bubble belongs to a deliberate selection.
        (e.isFocused || element.contains(document.activeElement)) &&
        (e.isActive("resource") ||
          e.isActive("button") ||
          e.isActive("variable") ||
          (c.print !== "none" && e.isActive("divider")) ||
          (c.print === "none" && findRepeatTable(e) !== null))
      }
    >
      {selectedBlock !== null ? renderBlockOptionsBar(c, selectedBlock) : renderBubbleRepeatBar(c)}
    </BubbleMenu>
  );
}

export function renderInlineRepeatBar(c: TiptapContext): ReactNode {
  const { t, Button, editor } = c;
  const repeatTable = c.activeState?.repeatTable ?? null;
  return (
    repeatTable !== null &&
    c.print === "none" &&
    !c.readOnly &&
    !c.canvas && (
      <div
        data-testid="document-repeat-bar"
        className="flex flex-wrap items-center gap-3 border-b border-input bg-muted/40 px-2 py-1 text-xs"
      >
        <span className="font-medium">{repeatBarLabelOf(c)}</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          pressed={repeatTable.headerRepeats}
          onClick={() => toggleRepeatHeader(editor)}
        >
          {t("template-resolver.documentEditor.repeatHeader")}
        </Button>
      </div>
    )
  );
}
