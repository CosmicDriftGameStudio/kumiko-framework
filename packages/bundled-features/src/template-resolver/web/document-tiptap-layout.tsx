import { cn } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { InsertPanel } from "./document-insert-panel.tsx";
import { renderBubbleMenu, renderInlineRepeatBar } from "./document-tiptap-bubble.tsx";
import type { TiptapContext } from "./document-tiptap-context.ts";
import { renderToolbarBar } from "./document-tiptap-toolbar.tsx";

function renderInsertPanel(c: TiptapContext): ReactNode {
  const { openPanel } = c;
  return (
    openPanel !== null &&
    !c.readOnly && (
      <InsertPanel
        key={openPanel}
        editor={c.editor}
        editorId={c.id}
        kind={openPanel}
        variables={openPanel === "images" ? c.imageVariables : c.variables}
        variableLabels={c.stableLabels}
        onClose={() => c.setOpenPanel(null)}
      />
    )
  );
}

export function renderHostedEditor(
  c: TiptapContext,
  toolbarHost: HTMLElement | null,
  editorContent: ReactNode,
): ReactNode {
  return (
    <>
      {toolbarHost !== null &&
        createPortal(
          <>
            {renderToolbarBar(c)}
            {renderInsertPanel(c)}
          </>,
          toolbarHost,
        )}
      {!c.readOnly && renderBubbleMenu(c)}
      {editorContent}
    </>
  );
}

function renderHtmlSource(c: TiptapContext): ReactNode {
  return (
    c.canvas &&
    !c.hosted &&
    c.showHtml && (
      <section aria-label={c.t("template-resolver.documentEditor.htmlSource")}>
        <pre className="h-40 overflow-auto whitespace-pre-wrap break-all border-b border-input bg-muted p-2 font-mono text-xs">
          {c.activeState?.html ?? ""}
        </pre>
      </section>
    )
  );
}

export function renderInlineEditor(c: TiptapContext, paper: ReactNode): ReactNode {
  const { canvas, hosted } = c;
  return (
    <div
      className={cn(
        canvas ? "flex min-h-0 flex-1 flex-col" : "rounded-md border border-input bg-transparent",
      )}
    >
      {!hosted && renderToolbarBar(c)}
      {canvas && !c.readOnly && renderBubbleMenu(c)}
      {renderHtmlSource(c)}
      {!hosted && renderInsertPanel(c)}
      {renderInlineRepeatBar(c)}
      <div
        ref={c.setCanvasScroller}
        className={cn(canvas && "min-h-0 flex-1 overflow-auto bg-muted px-8 py-6")}
      >
        {paper}
      </div>
    </div>
  );
}
