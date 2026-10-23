import type { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch, TextareaField } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import type { EditorTab, Translate } from "./layout-editor-logic.ts";
import { renderPaper } from "./layout-editor-paper.tsx";
import type { LayoutEditorBodyProps, LayoutEditorModel } from "./use-layout-editor-state.ts";

type Banner = ReturnType<typeof usePrimitives>["Banner"];

function renderToolbarRow(t: Translate, m: LayoutEditorModel): ReactNode {
  return (
    <div className="flex items-center border-b bg-background">
      <div ref={m.setToolbarHost} className="min-w-0 flex-1" />
      {m.showMjmlTab && (
        <div className="shrink-0 px-3 py-1">
          <ModeSwitch<EditorTab>
            value={m.tab}
            onChange={m.setTab}
            ariaLabel={t("documentDesigner.editor.tabSwitch")}
            testId="layout-mjml-tab"
            options={[
              { value: "draft", label: t("documentDesigner.editor.tab.draft") },
              { value: "mjml", label: t("documentDesigner.editor.tab.mjml") },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function renderMjmlNotice(Banner: Banner, t: Translate, props: LayoutEditorBodyProps): ReactNode {
  return (
    <Banner variant="info" testId="document-designer-mjml-notice">
      {t(
        props.isSystemAdmin
          ? "documentDesigner.editor.mjmlNotice.platform"
          : "documentDesigner.editor.mjmlNotice.tenant",
      )}
    </Banner>
  );
}

function renderDraftCanvas(
  Banner: Banner,
  t: Translate,
  props: LayoutEditorBodyProps,
  m: LayoutEditorModel,
): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {props.source.effectiveFormat === "mjml" && renderMjmlNotice(Banner, t, props)}
      {renderPaper(t, m)}
    </div>
  );
}

function renderMjmlSource(t: Translate, m: LayoutEditorModel): ReactNode {
  return (
    <TextareaField
      id="document-designer-mjml-source"
      name="mjml"
      label={t("documentDesigner.editor.mjml.label")}
      value={m.mjml}
      onChange={m.setMjml}
      rows={24}
      testId="document-designer-mjml-source"
    />
  );
}

export function renderCenter(
  Banner: Banner,
  t: Translate,
  props: LayoutEditorBodyProps,
  m: LayoutEditorModel,
): ReactNode {
  return (
    <>
      {renderToolbarRow(t, m)}
      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        {m.mjmlMode ? renderMjmlSource(t, m) : renderDraftCanvas(Banner, t, props, m)}
      </div>
    </>
  );
}
