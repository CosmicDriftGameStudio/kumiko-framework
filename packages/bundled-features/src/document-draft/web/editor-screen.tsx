import {
  dispatcherErrorTextWithFieldIssues,
  PreviewPane,
  statusToneForOptionTone,
  useMutation,
  useNav,
  usePrimitives,
  useQuery,
  useTenantCurrency,
  useTranslation,
  useUnsavedInputSource,
} from "@cosmicdrift/kumiko-renderer";
import {
  type DispatcherError,
  DOCUMENT_FALLBACK_CURRENCY,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  type Translate,
} from "@cosmicdrift/kumiko-renderer/headless";
import {
  EditorWorkbench,
  LoadingState,
  RailField,
  RailRow,
  RailSection,
  StatusBadge,
} from "@cosmicdrift/kumiko-renderer/web";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useRef, useState } from "react";
import {
  COMPANY_PLACEHOLDERS,
  DocumentContentEditor,
  dateVariableNames,
  PDF_DOCUMENT_BLOCKS,
  systemPlaceholderLabel,
  translatedOr,
} from "../../template-resolver/web/index.ts";
import {
  DOCUMENT_DRAFT_STATUS,
  DOCUMENT_DRAFT_STATUS_TONE,
  DocumentDraftHandlers,
  DocumentDraftQueries,
  type DocumentDraftStatus,
} from "./constants.ts";

type Deviation = { readonly change: "same" | "added" | "removed"; readonly content: string };

type DraftRecord = {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectScreen: string | null;
  readonly templateSlug: string;
  readonly templateTitle: string | null;
  readonly locale: string;
  readonly templateVariant: string | null;
  readonly status: DocumentDraftStatus;
  readonly revision: number;
  readonly version: number;
  readonly fileName: string | null;
  readonly body: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly deviations: readonly Deviation[];
};

const TEST_ID = "document-draft-workbench";
const BODY_EDITOR_ID = "document-draft-body";
const MAX_DEVIATION_TEXT_LENGTH = 120;

function isShownValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function hasMoneyVariable(record: DraftRecord): boolean {
  return Object.values(record.variableSchema).some(
    (definition) => propertyOf(definition, "type") === "money",
  );
}

// Same formatting the printed PDF applies, so the chip shows what the document will say.
// A money amount waits for the tenant currency instead of showing a raw number.
function formatVariable(
  value: string | number | boolean,
  type: unknown,
  locale: string,
  currency: string | undefined,
): string {
  if (type === "money" && currency !== undefined)
    return formatDocumentMoney(value, currency, locale);
  if (type === "date") return formatDocumentDate(value, locale);
  if (type === "percent") return formatDocumentPercent(value, locale);
  return String(value);
}

// Filled in only when the PDF is printed, so the chip names them like the template editor does.
const SYSTEM_VARIABLES: readonly string[] = ["tenantName", ...COMPANY_PLACEHOLDERS];

function addDeclaredLabel(
  t: Translate,
  labels: Record<string, string>,
  key: string,
  label: unknown,
): void {
  if (typeof label === "string" && label !== "") labels[key] = translatedOr(t, label, label);
}

// A chip with a value shows it formatted; without one it shows what the variable is called, never
// the raw key.
function variableLabelsOf(
  t: Translate,
  record: DraftRecord,
  currency: string | undefined,
): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const name of SYSTEM_VARIABLES) {
    labels[name] = systemPlaceholderLabel(t, name);
  }
  for (const [name, definition] of Object.entries(record.variableSchema)) {
    const value = record.variables[name];
    if (isShownValue(value) && String(value) !== "") {
      labels[name] = formatVariable(value, propertyOf(definition, "type"), record.locale, currency);
      continue;
    }
    addDeclaredLabel(t, labels, name, propertyOf(definition, "label"));
    // A chip inside a repeat row is addressed as `list.field`, like the template editor does.
    const item = propertyOf(definition, "item");
    if (isPlainObject(item)) {
      for (const [itemName, itemDefinition] of Object.entries(item)) {
        addDeclaredLabel(t, labels, `${name}.${itemName}`, propertyOf(itemDefinition, "label"));
      }
    }
  }
  return labels;
}

// A title may be an i18n key or plain text; t() returns the key itself without a translation.
function templateLabelOf(t: Translate, record: DraftRecord): string {
  if (hasNoTitle(record)) return record.templateSlug;
  return t(record.templateTitle ?? record.templateSlug);
}

function statusBadgeToneOf(status: DocumentDraftStatus) {
  return statusToneForOptionTone(DOCUMENT_DRAFT_STATUS_TONE[status]) ?? "muted";
}

function hasNoTitle(record: DraftRecord): boolean {
  return record.templateTitle === null || record.templateTitle === "";
}

function plainTextOf(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_DEVIATION_TEXT_LENGTH
    ? `${text.slice(0, MAX_DEVIATION_TEXT_LENGTH)}…`
    : text;
}

// Deviations carry no id and two blocks can be identical, so the key counts repeats.
function keyedDeviations(
  deviations: readonly Deviation[],
): readonly { readonly key: string; readonly deviation: Deviation }[] {
  const seen = new Map<string, number>();
  return deviations.map((deviation) => {
    const base = `${deviation.change}:${deviation.content}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { key: `${base}#${count}`, deviation };
  });
}

function DraftRail({
  record,
  actions,
  testId,
}: {
  readonly record: DraftRecord;
  readonly actions: ReactNode;
  readonly testId: string;
}): ReactNode {
  const t = useTranslation();
  const changed = record.deviations.filter((deviation) => deviation.change !== "same");
  return (
    <>
      <RailSection title={t("document-draft:editor.railTemplate")} testId={`${testId}-template`}>
        <RailRow
          label={t("document-draft:editor.template")}
          trailing={templateLabelOf(t, record)}
        />
        {record.templateVariant !== null && hasNoTitle(record) && (
          <RailRow label={t("document-draft:editor.variant")} trailing={record.templateVariant} />
        )}
        <RailRow label={t("document-draft:editor.revision")} trailing={String(record.revision)} />
        {record.fileName !== null && (
          <RailRow
            label={t("document-draft:editor.file")}
            trailing={record.fileName}
            testId={`${testId}-file`}
          />
        )}
      </RailSection>
      <RailSection
        title={t("document-draft:editor.railDeviations")}
        testId={`${testId}-deviations`}
      >
        {changed.length === 0 ? (
          <RailRow label={t("document-draft:editor.noDeviations")} />
        ) : (
          keyedDeviations(changed).map(({ key, deviation }) => (
            <RailRow
              key={key}
              label={t(`document-draft:editor.deviation.${deviation.change}`)}
              trailing={plainTextOf(deviation.content)}
              testId={`${testId}-deviation`}
            />
          ))
        )}
      </RailSection>
      {actions}
    </>
  );
}

function DraftEditor({
  record,
  onChanged,
}: {
  readonly record: DraftRecord;
  readonly onChanged: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const nav = useNav();
  const [html, setHtml] = useState(record.body);
  const [resetCount, setResetCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const tenantCurrency = useTenantCurrency(hasMoneyVariable(record), DOCUMENT_FALLBACK_CURRENCY);
  const currency = tenantCurrency.status === "ready" ? tenantCurrency.currency : undefined;
  const save = useMutation(DocumentDraftHandlers.save);
  const finalize = useMutation(DocumentDraftHandlers.finalize);
  const revise = useMutation(DocumentDraftHandlers.revise);
  const discard = useMutation(DocumentDraftHandlers.discard);
  const open = record.status === DOCUMENT_DRAFT_STATUS.Open;
  const dirty = open && html !== record.body;
  const busy = save.pending || finalize.pending || revise.pending || discard.pending;
  useUnsavedInputSource(() => dirty && !savedRef.current);

  const failureText = (error: DispatcherError): string =>
    error.code === "version_conflict"
      ? t("document-draft:editor.versionConflict")
      : dispatcherErrorTextWithFieldIssues(error, t);

  const leaveToSubject = (): void => {
    if (record.subjectScreen === null) {
      onChanged();
      return;
    }
    nav.navigate({ screenId: record.subjectScreen, entityId: record.subjectId });
  };

  const run = async (
    mutation: typeof save,
    payload: Readonly<Record<string, unknown>>,
    onDone: () => void,
  ): Promise<void> => {
    setActionError(null);
    const result = await mutation.mutate({ id: record.id, ...payload });
    if (!result.isSuccess) {
      setActionError(failureText(result.error));
      return;
    }
    onDone();
  };

  const onSave = (): void => {
    void run(save, { base: record.version, content: html }, () => {
      savedRef.current = true;
      onChanged();
    });
  };
  const onFinalize = (): void => {
    void run(finalize, { base: record.version }, leaveToSubject);
  };
  const onDiscardDraft = (): void => {
    void run(discard, { base: record.version }, leaveToSubject);
  };
  const onRevise = (): void => {
    void run(revise, { base: record.version }, onChanged);
  };
  const onRevert = (): void => {
    setHtml(record.body);
    setActionError(null);
    setResetCount((count) => count + 1);
  };

  const actions = (
    <RailSection title={t("document-draft:editor.railActions")} testId={`${TEST_ID}-actions`}>
      <RailField>
        {open ? (
          <>
            <Button
              variant="primary"
              width="full"
              disabled={dirty || busy}
              loading={finalize.pending}
              onClick={onFinalize}
              testId={`${TEST_ID}-finalize`}
            >
              {t("document-draft:editor.finalize")}
            </Button>
            {dirty && <RailRow label={t("document-draft:editor.finalizeNeedsSave")} />}
            <Button
              variant="danger-ghost"
              width="full"
              disabled={busy}
              loading={discard.pending}
              onClick={onDiscardDraft}
              testId={`${TEST_ID}-discard`}
            >
              {t("document-draft:editor.discardDraft")}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            width="full"
            disabled={busy || record.status !== DOCUMENT_DRAFT_STATUS.Finalized}
            loading={revise.pending}
            onClick={onRevise}
            testId={`${TEST_ID}-revise`}
          >
            {t("document-draft:editor.revise")}
          </Button>
        )}
      </RailField>
    </RailSection>
  );
  const rail = <DraftRail record={record} actions={actions} testId={`${TEST_ID}-rail`} />;

  return (
    <EditorWorkbench
      testId={TEST_ID}
      title={
        hasNoTitle(record) && record.templateVariant !== null
          ? `${record.templateSlug} / ${record.templateVariant}`
          : templateLabelOf(t, record)
      }
      status={
        <StatusBadge tone={statusBadgeToneOf(record.status)} testId={`${TEST_ID}-status`}>
          {t(`document-draft:editor.status.${record.status}`)}
        </StatusBadge>
      }
      info={{
        edit: open ? t("document-draft:editor.infoEdit") : t("document-draft:editor.infoFinalized"),
        preview: t("document-draft:editor.infoPreview"),
      }}
      edit={
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
          <DocumentContentEditor
            key={resetCount}
            id={BODY_EDITOR_ID}
            value={html}
            onChange={setHtml}
            variables={Object.keys(record.variableSchema)}
            variableLabels={variableLabelsOf(t, record, currency)}
            systemVariables={SYSTEM_VARIABLES}
            dateVariables={dateVariableNames(record.variableSchema)}
            blocks={PDF_DOCUMENT_BLOCKS}
            readOnly={!open}
          />
        </div>
      }
      preview={
        <PreviewPane
          target="web"
          content={html}
          editFormat="document"
          variables={record.variables}
          subject={{ kind: "body" }}
        />
      }
      rail={{ edit: rail, preview: rail }}
      save={{
        busy: save.pending,
        canSave: dirty && !busy,
        dirty,
        onSave,
        onDiscard: onRevert,
        saveError: actionError,
        saveLabel: t("document-draft:editor.save"),
      }}
    />
  );
}

export function DocumentDraftEditorScreen(): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const nav = useNav();
  const entityId = nav.route?.entityId;
  const detail = useQuery<DraftRecord | null>(
    DocumentDraftQueries.blocks,
    { id: entityId ?? "" },
    { enabled: entityId !== undefined },
  );
  if (entityId === undefined || detail.error !== null) {
    return <Banner variant="error">{t("document-draft:editor.loadFailed")}</Banner>;
  }
  if (detail.data === null) return <LoadingState />;
  return (
    <DraftEditor
      key={`${detail.data.id}:${detail.data.version}`}
      record={detail.data}
      onChanged={() => void detail.refetch()}
    />
  );
}
