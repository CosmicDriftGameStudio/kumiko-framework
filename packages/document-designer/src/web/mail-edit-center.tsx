// @runtime client
import {
  DocumentContentEditor,
  type DocumentResourcePreview,
  MAIL_DOCUMENT_BLOCKS,
  PlaceholderLineEditor,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { MailDraft } from "./mail-types.js";
import type { InsertTargets } from "./use-insert-targets.js";

export type EditorVocabulary = {
  readonly names: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly system: readonly string[];
};

function MetaLine({
  label,
  testId,
  onFocusCapture,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly onFocusCapture: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2"
      data-testid={testId}
      onFocusCapture={onFocusCapture}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function MailEditCenter({
  draft,
  vocabulary,
  resourcePreviews,
  insert,
  readOnly,
  onChange,
}: {
  readonly draft: MailDraft;
  readonly vocabulary: EditorVocabulary;
  readonly resourcePreviews: Readonly<Record<string, DocumentResourcePreview>>;
  readonly insert: InsertTargets;
  readonly readOnly: boolean;
  readonly onChange: (patch: Partial<MailDraft>) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="mail-editor-center">
      <div className="flex flex-col gap-2 rounded-md border bg-muted p-3">
        <MetaLine
          label={t("documentDesigner.mail.meta.subject")}
          testId="mail-meta-subject"
          onFocusCapture={insert.markFocused("subject")}
        >
          <PlaceholderLineEditor
            id="mail-subject"
            value={draft.subject}
            onChange={(subject) => onChange({ subject })}
            variableLabels={vocabulary.labels}
            systemVariables={vocabulary.system}
            readOnly={readOnly}
            onEditorReady={insert.register("subject")}
            aria-label={t("documentDesigner.mail.meta.subject")}
          />
        </MetaLine>
        <MetaLine
          label={t("documentDesigner.mail.meta.previewText")}
          testId="mail-meta-preview-text"
          onFocusCapture={insert.markFocused("previewText")}
        >
          <PlaceholderLineEditor
            id="mail-preview-text"
            value={draft.previewText}
            onChange={(previewText) => onChange({ previewText })}
            variableLabels={vocabulary.labels}
            systemVariables={vocabulary.system}
            readOnly={readOnly}
            onEditorReady={insert.register("previewText")}
            aria-label={t("documentDesigner.mail.meta.previewText")}
          />
        </MetaLine>
      </div>
      <div onFocusCapture={insert.markFocused("body")} data-testid="mail-content">
        <DocumentContentEditor
          id="mail-body"
          value={draft.body}
          onChange={(body) => onChange({ body })}
          variables={vocabulary.names}
          readOnly={readOnly}
          blocks={MAIL_DOCUMENT_BLOCKS}
          variableLabels={vocabulary.labels}
          systemVariables={vocabulary.system}
          resourcePreviews={resourcePreviews}
          chrome="canvas"
          onEditorReady={insert.register("body")}
        />
      </div>
    </div>
  );
}
