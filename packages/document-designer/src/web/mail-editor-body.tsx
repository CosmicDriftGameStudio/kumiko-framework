import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { EditorHeader, EditorModeSwitch, originOf } from "./editor-header.tsx";
import { EditorFooter, EditorFrame } from "./editor-shell.tsx";
import { MailConfirmDialogs } from "./mail-dialogs.tsx";
import type { MailEditorBodyProps } from "./mail-editor-logic.ts";
import {
  renderMailBanners,
  renderMailControls,
  renderMailEditBody,
  renderMailModals,
} from "./mail-editor-render.tsx";
import { MailOriginBar } from "./mail-origin-bar.tsx";
import { renderMailPreview } from "./mail-preview-render.tsx";
import { useMailEditorState } from "./use-mail-editor-state.ts";

export type { MailEditorBodyProps } from "./mail-editor-logic.ts";
export { placeholderNames } from "./mail-editor-logic.ts";

export function MailEditorBody(props: MailEditorBodyProps): ReactNode {
  const { locale, title, isSystemAdmin, row, onReload } = props;
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const m = useMailEditorState(props, t);
  const { mode, setMode, setDialog, setResetError } = m.ui;
  const saveDraft = (): void => void m.saveAndReload(false);
  const publish = (): void => void m.saveAndReload(true);
  const controls = renderMailControls(props, m);
  const origin =
    row === null ? null : originOf(row.scope !== "tenant", props.systemVersion !== null);

  return (
    <EditorFrame testId="document-designer-mail-editor">
      <EditorHeader
        title={title}
        stored={row === null ? null : { status: row.status, version: row.version }}
        actions={{
          busy: m.busy,
          canSave: m.canSave,
          canPublish: m.canPublish,
          onSave: saveDraft,
          onPublish: publish,
        }}
      >
        <EditorModeSwitch testIdPrefix="mail" mode={mode} onMode={setMode} />
      </EditorHeader>
      {mode === "edit" && (
        <MailOriginBar
          row={row}
          systemVersion={props.systemVersion}
          locale={locale}
          isSystemAdmin={isSystemAdmin}
          creating={m.ui.creating}
          controls={controls}
          onReload={() => {
            setResetError(null);
            void onReload();
          }}
          onResetError={setResetError}
        />
      )}
      {renderMailBanners(Banner, t, m)}
      {mode === "edit"
        ? renderMailEditBody(props, m)
        : renderMailPreview(props, m, controls, origin)}
      {!m.locked && (
        <EditorFooter
          testIdPrefix="mail-editor"
          message={m.footer}
          saveError={m.services.persistence.error}
          modifiedAt={row?.modifiedAt ?? null}
          dirty={m.dirty}
          busy={m.busy}
          canSave={m.canSave}
          canPublish={m.canPublish}
          onDiscard={() => setDialog({ kind: "discard" })}
          onSave={saveDraft}
          onPublish={publish}
        />
      )}
      {renderMailModals(props, m)}
      <MailConfirmDialogs
        dialog={m.ui.dialog}
        onClose={() => setDialog({ kind: "none" })}
        onDiscard={() => {
          m.reset();
          setDialog({ kind: "none" });
        }}
        onRemove={m.removeResource}
        onLeaveSave={m.leaveSave}
        onLeaveDiscard={(target) => {
          setDialog({ kind: "none" });
          m.perform(target);
        }}
      />
    </EditorFrame>
  );
}
