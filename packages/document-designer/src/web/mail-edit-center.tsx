import {
  DocumentContentEditor,
  type DocumentResourcePreview,
  MAIL_DOCUMENT_BLOCKS,
  PlaceholderLineEditor,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { MailMetaField } from "./mail-footer.ts";
import type { MailDraft } from "./mail-types.ts";
import type { InsertTargets } from "./use-insert-targets.ts";

const renderMailPaper = (editable: ReactNode): ReactNode => (
  <div className="mx-auto w-full max-w-[600px] bg-card px-10 py-7 shadow-md">{editable}</div>
);

export type EditorVocabulary = {
  readonly names: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly system: readonly string[];
};

function MetaLine({
  label,
  testId,
  error,
  onFocusCapture,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly error: string | undefined;
  readonly onFocusCapture: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className="grid min-h-10 grid-cols-[84px_minmax(0,1fr)] items-center border-b bg-background px-4"
      data-testid={testId}
      onFocusCapture={onFocusCapture}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        {error !== undefined && (
          <span className="shrink-0 text-xs text-status-bad" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

export function MailEditCenter({
  draft,
  vocabulary,
  resourcePreviews,
  insert,
  readOnly,
  fieldErrors,
  onChange,
}: {
  readonly draft: MailDraft;
  readonly vocabulary: EditorVocabulary;
  readonly resourcePreviews: Readonly<Record<string, DocumentResourcePreview>>;
  readonly insert: InsertTargets;
  readonly readOnly: boolean;
  readonly fieldErrors: Partial<Record<MailMetaField, string>>;
  readonly onChange: (patch: Partial<MailDraft>) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="mail-editor-center">
      <MetaLine
        label={t("documentDesigner.mail.meta.subject")}
        testId="mail-meta-subject"
        error={fieldErrors.subject}
        onFocusCapture={insert.markFocused("subject")}
      >
        <PlaceholderLineEditor
          id="mail-subject"
          value={draft.subject}
          onChange={(subject) => onChange({ subject })}
          variableLabels={vocabulary.labels}
          systemVariables={vocabulary.system}
          readOnly={readOnly}
          flat
          onEditorReady={insert.register("subject")}
          aria-label={t("documentDesigner.mail.meta.subject")}
        />
      </MetaLine>
      <MetaLine
        label={t("documentDesigner.mail.meta.previewText")}
        testId="mail-meta-preview-text"
        error={fieldErrors.previewText}
        onFocusCapture={insert.markFocused("previewText")}
      >
        <PlaceholderLineEditor
          id="mail-preview-text"
          value={draft.previewText}
          onChange={(previewText) => onChange({ previewText })}
          variableLabels={vocabulary.labels}
          systemVariables={vocabulary.system}
          readOnly={readOnly}
          flat
          placeholder={t("documentDesigner.mail.meta.previewTextPlaceholder")}
          onEditorReady={insert.register("previewText")}
          aria-label={t("documentDesigner.mail.meta.previewText")}
        />
      </MetaLine>
      <div
        className="flex min-h-0 flex-1 flex-col"
        onFocusCapture={insert.markFocused("body")}
        data-testid="mail-content"
      >
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
          renderPaper={renderMailPaper}
          onEditorReady={insert.register("body")}
        />
      </div>
    </div>
  );
}
