import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import type { useDispatcher } from "@cosmicdrift/kumiko-renderer";
import { uploadFileRef } from "@cosmicdrift/kumiko-renderer/web";
import { RendererPuppeteerClientQueries } from "@cosmicdrift/kumiko-renderer-puppeteer-client/qualified-names";
import { describeError, isAlreadyActive } from "./errors.ts";
import {
  type Draft,
  draftFromDetail,
  type EditorState,
  SETTLE_MS,
  snapshotOf,
} from "./pdf-editor-draft.ts";
import { EMPTY_PDF_META, serializePdfMeta } from "./pdf-meta.ts";
import {
  DOCUMENT_PDF_KIND,
  type PdfPreviewResult,
  type SaveResult,
  type TemplateDetail,
} from "./types.ts";
import type { PdfEditorState } from "./use-pdf-editor-state.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export type PdfActionsInput = {
  readonly s: PdfEditorState;
  readonly t: Translate;
  readonly dispatcher: ReturnType<typeof useDispatcher>;
  readonly slug: string;
  readonly current: EditorState;
  readonly detail: TemplateDetail;
  readonly dirty: boolean;
  readonly onLocaleChange: ((locale: string) => void) | undefined;
};

function draftActions(input: PdfActionsInput) {
  const { s } = input;
  const { setState } = s.doc;
  const { settleTimer } = s;

  function updateDraft(next: Draft): void {
    setState((previous) => (previous === null ? previous : { ...previous, draft: next }));
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      setState((previous) =>
        previous === null ? previous : { ...previous, settled: previous.draft },
      );
    }, SETTLE_MS);
  }

  function resetDraft(source: TemplateDetail): void {
    const draft = draftFromDetail(source);
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    setState({ key: source.id, draft, settled: draft, snapshot: snapshotOf(draft) });
    s.ui.setDraftEpoch((epoch) => epoch + 1);
    s.ui.setActionError(null);
  }

  return { updateDraft, resetDraft };
}

function writeActions(input: PdfActionsInput) {
  const { s, t, dispatcher, slug, current, detail, dirty } = input;
  const { locale, rowsQuery, detailQuery, setState } = s.doc;
  const { variableSchema, validationQuery } = s.server;
  const { scope } = s.host;
  const { setBusy, setActionError } = s.ui;

  async function reload(): Promise<void> {
    await Promise.all([rowsQuery.refetch(), detailQuery.refetch(), validationQuery.refetch()]);
  }

  async function persist(): Promise<SaveResult | null> {
    const draft = current?.draft ?? { content: "", meta: EMPTY_PDF_META };
    const parentTemplateId = detail?.scope === "system" ? detail.id : detail?.parentTemplateId;
    const result = await dispatcher.write<SaveResult>(
      scope === "system"
        ? TemplateResolverHandlers.upsertSystem
        : TemplateResolverHandlers.upsertTenant,
      {
        slug,
        kind: DOCUMENT_PDF_KIND,
        locale,
        content: draft.content,
        contentFormat: "html",
        variableSchema,
        meta: serializePdfMeta(draft.meta),
        ...(scope === "tenant" && parentTemplateId != null && { parentTemplateId }),
      },
    );
    if (!result.isSuccess) {
      setActionError(describeError(t, result.error));
      return null;
    }
    setState((previous) =>
      previous === null ? previous : { ...previous, snapshot: snapshotOf(draft) },
    );
    return result.data;
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    setActionError(null);
    const saved = await persist();
    if (saved !== null) await reload();
    setBusy(null);
    return saved !== null;
  }

  async function publish(): Promise<void> {
    setBusy("publish");
    setActionError(null);
    // A system save activates immediately; a tenant row needs a save first when it
    // does not exist yet or carries unsaved edits, then an explicit publish.
    const needsSave = dirty || detail?.scope === "system";
    const saved = needsSave ? await persist() : null;
    const saveFailed = needsSave && saved === null;
    // upsertSystem already activates, so only a tenant row needs the explicit publish.
    const alreadyActivatedBySave = scope === "system" && saved !== null;
    const templateId = saved?.id ?? detail?.id ?? null;
    if (templateId !== null && !saveFailed && !alreadyActivatedBySave) {
      const result = await dispatcher.write(
        scope === "system"
          ? TemplateResolverHandlers.publishSystem
          : TemplateResolverHandlers.publish,
        { id: templateId },
      );
      if (!result.isSuccess && !isAlreadyActive(result.error))
        setActionError(describeError(t, result.error));
    }
    await reload();
    setBusy(null);
  }

  return { save, publish };
}

function pdfActions(input: PdfActionsInput) {
  const { s, t, dispatcher, slug, current, detail, dirty, onLocaleChange } = input;
  const { locale, detailQuery } = s.doc;
  const { variableSchema } = s.server;
  const { setMode, setBusy, setActionError, setGenerated, autoPrintedFor, setPendingLocale } = s.ui;

  async function generatePdf(): Promise<void> {
    // skip: no editor state to print
    if (current === null) return;
    setMode("preview");
    setBusy("pdf");
    setActionError(null);
    const forSnapshot = snapshotOf(current.draft);
    const result = await dispatcher.query<PdfPreviewResult>(
      RendererPuppeteerClientQueries.previewPdf,
      {
        slug,
        locale,
        content: current.draft.content,
        meta: serializePdfMeta(current.draft.meta),
        variableSchema,
      },
    );
    if (result.isSuccess) setGenerated({ forSnapshot, result: result.data });
    else setActionError(describeError(t, result.error));
    setBusy(null);
  }

  function printOnce(): void {
    // skip: this draft was already printed
    if (current === null || autoPrintedFor.current === snapshotOf(current.draft)) return;
    autoPrintedFor.current = snapshotOf(current.draft);
    void generatePdf();
  }

  async function uploadResource(file: File): Promise<void> {
    const sourceFileRefId = await uploadFileRef(file);
    const result = await dispatcher.write(TemplateResolverHandlers.resourceUpload, {
      templateId: detail?.id,
      sourceFileRefId,
    });
    if (!result.isSuccess) throw new Error(describeError(t, result.error));
    await detailQuery.refetch();
  }

  function requestLocale(next: string): void {
    // skip: the requested locale is already open
    if (next === locale) return;
    if (dirty) setPendingLocale(next);
    else onLocaleChange?.(next);
  }

  return { generatePdf, printOnce, uploadResource, requestLocale };
}

export function buildPdfActions(input: PdfActionsInput) {
  return { ...draftActions(input), ...writeActions(input), ...pdfActions(input) };
}

export type PdfActions = ReturnType<typeof buildPdfActions>;
