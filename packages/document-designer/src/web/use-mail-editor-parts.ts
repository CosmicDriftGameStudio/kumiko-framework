import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useMutation } from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";
import type { EditorMode } from "./editor-header.tsx";
import type { ConfirmDialog } from "./mail-dialogs.tsx";
import { loadedMailOf } from "./mail-draft.ts";
import type { MailEditorBodyProps } from "./mail-editor-logic.ts";
import { useFilesCapability } from "./use-files-capability.ts";
import { useInsertTargets } from "./use-insert-targets.ts";
import { useMailPersistence } from "./use-mail-persistence.ts";
import { useOverviewRows } from "./use-overview-rows.ts";
import { useOwnAddress } from "./use-own-address.ts";
import { useSettledValue } from "./use-settled-value.ts";
import { useTestMail } from "./use-test-mail.ts";

export function useMailUiState(row: MailEditorBodyProps["row"]) {
  const [baseline] = useState(() => loadedMailOf(row));
  const [draft, setDraft] = useState(baseline);
  const [settled, settle] = useSettledValue(baseline);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialog>({ kind: "none" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [prefixSubject, setPrefixSubject] = useState(true);
  return {
    baseline,
    draft,
    setDraft,
    settled,
    settle,
    mode,
    setMode,
    creating,
    setCreating,
    dialog,
    setDialog,
    uploadOpen,
    setUploadOpen,
    pdfOpen,
    setPdfOpen,
    resourceError,
    setResourceError,
    resetError,
    setResetError,
    editorEpoch,
    setEditorEpoch,
    includeAttachments,
    setIncludeAttachments,
    prefixSubject,
    setPrefixSubject,
  };
}

export type MailUiState = ReturnType<typeof useMailUiState>;
export type MailServices = ReturnType<typeof useMailServices>;

export function useMailServices(props: MailEditorBodyProps) {
  const { slug, locale, title, isSystemAdmin, row } = props;
  const insert = useInsertTargets();
  const persistence = useMailPersistence({ slug, locale, title, isSystemAdmin, row });
  const testMail = useTestMail();
  const own = useOwnAddress();
  const filesAvailable = useFilesCapability();
  const resourceRemove = useMutation(TemplateResolverHandlers.resourceRemove);
  const layouts = useOverviewRows("mail-layout");
  const pdfTemplates = useOverviewRows("document-pdf");
  return {
    insert,
    persistence,
    testMail,
    own,
    filesAvailable,
    resourceRemove,
    layouts,
    pdfTemplates,
  };
}
