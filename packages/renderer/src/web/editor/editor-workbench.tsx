import { type ReactNode, useState } from "react";
import { useTranslation } from "../../i18n.tsx";
import { EditorFooter } from "./editor-footer.tsx";
import { EditorBody, EditorFrame, EditorInfoBar } from "./editor-frame.tsx";
import { EditorHeader, type EditorMode, EditorModeSwitch } from "./editor-header.tsx";

export type WorkbenchSave = {
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly dirty: boolean;
  readonly onSave: () => void;
  readonly saveLabel?: string;
  readonly onDiscard: () => void;
  readonly saveError: string | null;
  readonly modifiedAt?: string | null;
};

export type EditorWorkbenchProps = {
  readonly testId: string;
  readonly title: string;
  readonly status?: ReactNode;
  /** Info bar text per mode. */
  readonly info: { readonly edit: ReactNode; readonly preview: ReactNode };
  /** Info bar controls shared by both modes, e.g. the locale switch. */
  readonly controls?: ReactNode;
  readonly banners?: ReactNode;
  readonly edit: ReactNode;
  readonly preview: ReactNode;
  /** Right rail per mode; `left` adds a rail on the left (a placeholder list) shown in both modes. */
  readonly rail: {
    readonly edit: ReactNode;
    readonly preview: ReactNode;
    readonly left?: ReactNode;
  };
  readonly save: WorkbenchSave;
};

// The shared edit/preview mask: editors that only differ in what they edit, which preview
// renderer they mount and which fields sit in the right rail compose this instead of a form.
export function EditorWorkbench({
  testId,
  title,
  status,
  info,
  controls,
  banners,
  edit,
  preview,
  rail,
  save,
}: EditorWorkbenchProps): ReactNode {
  const t = useTranslation();
  const [mode, setMode] = useState<EditorMode>("edit");
  const editing = mode === "edit";
  return (
    <EditorFrame testId={testId}>
      <EditorHeader
        title={title}
        status={status}
        actions={{
          busy: save.busy,
          canSave: save.canSave,
          onSave: save.onSave,
          ...(save.saveLabel !== undefined && { saveLabel: save.saveLabel }),
        }}
      >
        <EditorModeSwitch testIdPrefix={testId} mode={mode} onMode={setMode} />
      </EditorHeader>
      <EditorInfoBar tone="muted" testId={`${testId}-info`} controls={controls}>
        {editing ? info.edit : info.preview}
      </EditorInfoBar>
      {banners}
      <EditorBody
        testId={`${testId}-${mode}`}
        center={editing ? edit : preview}
        right={editing ? rail.edit : rail.preview}
        {...(rail.left !== undefined && { left: rail.left })}
      />
      <EditorFooter
        testIdPrefix={testId}
        message={save.dirty ? { tone: "warn", text: t("kumiko.editor.unsavedChanges") } : null}
        saveError={save.saveError}
        modifiedAt={save.modifiedAt ?? null}
        dirty={save.dirty}
        busy={save.busy}
        canSave={save.canSave}
        onDiscard={save.onDiscard}
        onSave={save.onSave}
        {...(save.saveLabel !== undefined && { saveLabel: save.saveLabel })}
      />
    </EditorFrame>
  );
}
