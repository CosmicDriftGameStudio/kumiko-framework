import { MAX_SELECTED_TEMPLATES } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { dispatcherErrorText, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { pluralKey } from "@cosmicdrift/kumiko-renderer/headless";
import { type ReactNode, useState } from "react";
import type { OverviewRowView } from "./overview-row.ts";
import { statusLabel } from "./status-label.ts";
import { DOCUMENT_PDF_KIND } from "./types.ts";
import {
  type ApplyLayoutResponse,
  type TemplateOutcome,
  type TemplateRef,
  templateOutcomeText,
  useApplyLayout,
} from "./use-apply-layout.ts";
import { useOverviewRows } from "./use-overview-rows.ts";
import { templateTitle } from "./used-by-label.ts";

type Mode = "all" | "selected";

const refKey = ({ slug, locale }: TemplateRef): string => `${slug}\u0000${locale}`;

// An open draft beside the served version is what the template shows as its state.
function rowStatusText(t: ReturnType<typeof useTranslation>, row: OverviewRowView): string {
  return row.draftVersion === null
    ? statusLabel(t, row.status, row.version)
    : statusLabel(t, "draft", row.draftVersion);
}

function TemplateRow({
  row,
  checked,
  onToggle,
  statusText,
}: {
  readonly row: OverviewRowView;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly statusText: string;
}): ReactNode {
  const t = useTranslation();
  const { Input, Field } = usePrimitives();
  const checkId = `layout-apply-check-${row.slug}`;
  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2"
      data-testid={`layout-apply-row-${row.slug}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Field id={checkId} label={templateTitle(t, row)} layout="inline">
          <Input
            kind="boolean"
            id={checkId}
            name="layout-apply-check"
            value={checked}
            onChange={onToggle}
          />
        </Field>
        <span className="text-xs text-muted-foreground">{row.locales.join(", ")}</span>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
    </li>
  );
}

function ResultList({
  items,
  label,
}: {
  readonly items: readonly TemplateOutcome[];
  readonly label: (item: TemplateOutcome) => string;
}): ReactNode {
  return (
    <ul className="list-disc pl-5 text-sm">
      {items.map((item) => (
        <li key={refKey(item)}>{label(item)}</li>
      ))}
    </ul>
  );
}

function TargetPicker({
  title,
  mode,
  onModeChange,
  rows,
  selected,
  onToggle,
  systemCount,
  entryCount,
  tooManyEntries,
}: {
  readonly title: string;
  readonly mode: Mode;
  readonly onModeChange: (mode: Mode) => void;
  readonly rows: readonly OverviewRowView[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (slug: string) => void;
  readonly systemCount: number;
  readonly entryCount: number;
  readonly tooManyEntries: boolean;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Input, Field } = usePrimitives();
  return (
    <>
      <p className="text-sm text-muted-foreground">{t("documentDesigner.applyLayout.intro")}</p>
      <Field id="layout-apply-mode" label={title} hideLabel>
        <Input
          kind="select"
          id="layout-apply-mode"
          name="layout-apply-mode"
          value={mode}
          onChange={(value) => onModeChange(value === "all" ? "all" : "selected")}
          radioVariant="card"
          options={[
            {
              value: "all",
              label: t("documentDesigner.applyLayout.all"),
              description: t("documentDesigner.applyLayout.allHint"),
            },
            {
              value: "selected",
              label: t("documentDesigner.applyLayout.selected"),
              description: t("documentDesigner.applyLayout.selectedHint"),
            },
          ]}
        />
      </Field>
      {mode === "selected" && (
        <ul className="flex max-h-64 flex-col divide-y overflow-auto rounded-md border">
          {rows.map((row) => (
            <TemplateRow
              key={row.slug}
              row={row}
              checked={selected.has(row.slug)}
              onToggle={() => onToggle(row.slug)}
              statusText={rowStatusText(t, row)}
            />
          ))}
        </ul>
      )}
      {mode === "selected" && systemCount > 0 && (
        <Banner variant="warning">
          {t(pluralKey("documentDesigner.applyLayout.systemWarning", systemCount), {
            count: systemCount,
          })}
        </Banner>
      )}
      {tooManyEntries && (
        <p className="text-xs text-destructive" data-testid="layout-apply-too-many">
          {t("documentDesigner.applyLayout.tooMany", {
            count: entryCount,
            max: MAX_SELECTED_TEMPLATES,
          })}
        </p>
      )}
    </>
  );
}

function ApplyResult({
  mode,
  applied,
  onClose,
}: {
  readonly mode: Mode;
  readonly applied: ApplyLayoutResponse;
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <div className="flex flex-col gap-3" data-testid="layout-apply-result">
      {mode === "all" ? (
        <p className="text-sm">{t("documentDesigner.applyLayout.allDone")}</p>
      ) : (
        <p className="text-sm">
          {t(pluralKey("documentDesigner.applyLayout.drafted", applied.applied.length), {
            count: applied.applied.length,
          })}
        </p>
      )}
      {applied.skipped.length > 0 && (
        <>
          <strong className="text-sm">{t("documentDesigner.applyLayout.skipped")}</strong>
          <ResultList items={applied.skipped} label={(item) => templateOutcomeText(t, item)} />
        </>
      )}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t("documentDesigner.applyLayout.close")}
        </Button>
      </div>
    </div>
  );
}

export function ApplyLayoutDialog({
  layoutSlug,
  layoutTitle,
  onOpenChange,
  onApplied,
}: {
  readonly layoutSlug: string;
  readonly layoutTitle: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApplied: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Modal, Button, Banner } = usePrimitives();
  const { rows } = useOverviewRows(DOCUMENT_PDF_KIND);
  const { apply } = useApplyLayout();
  const [mode, setMode] = useState<Mode>("selected");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [applied, setApplied] = useState<ApplyLayoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = rows.filter((row) => selected.has(row.slug));
  const systemCount = chosen.filter((row) => row.origin === "system").length;

  const toggle = (slug: string): void => {
    const next = new Set(selected);
    if (!next.delete(slug)) next.add(slug);
    setSelected(next);
  };

  const entries = chosen.flatMap((row) =>
    row.locales.map((locale) => ({ slug: row.slug, locale })),
  );
  const tooManyEntries = mode === "selected" && entries.length > MAX_SELECTED_TEMPLATES;

  const submit = async (): Promise<void> => {
    setError(null);
    const target = mode === "all" ? { mode } : { mode, templates: entries };
    const result = await apply.mutate({ layoutSlug, target });
    if (!result.isSuccess) {
      setError(dispatcherErrorText(result.error, t));
      return;
    }
    setApplied(result.data);
    onApplied();
  };

  const canSubmit = mode === "all" || (chosen.length > 0 && !tooManyEntries);
  const title = t("documentDesigner.applyLayout.title", { name: layoutTitle });
  const submitLabel =
    mode === "all"
      ? t("documentDesigner.applyLayout.submitAll")
      : chosen.length === 0
        ? t("documentDesigner.applyLayout.submitNone")
        : t(pluralKey("documentDesigner.applyLayout.submit", chosen.length), {
            count: chosen.length,
          });

  return (
    <Modal open onOpenChange={onOpenChange} title={title} size="wide" testId="layout-apply-dialog">
      <div className="flex flex-col gap-4">
        {error !== null && <Banner variant="error">{error}</Banner>}
        {applied === null ? (
          <>
            <TargetPicker
              title={title}
              mode={mode}
              onModeChange={setMode}
              rows={rows}
              selected={selected}
              onToggle={toggle}
              systemCount={systemCount}
              entryCount={entries.length}
              tooManyEntries={tooManyEntries}
            />
            <div className="flex items-end gap-4">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t("documentDesigner.applyLayout.note")}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  {t("documentDesigner.applyLayout.cancel")}
                </Button>
                <Button
                  disabled={!canSubmit || apply.pending}
                  loading={apply.pending}
                  onClick={submit}
                  testId="layout-apply-submit"
                >
                  {submitLabel}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <ApplyResult mode={mode} applied={applied} onClose={() => onOpenChange(false)} />
        )}
      </div>
    </Modal>
  );
}
