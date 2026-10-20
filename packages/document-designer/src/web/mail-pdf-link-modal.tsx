// @runtime client
import {
  PlaceholderLineEditor,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  useMutation,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { EmptyState } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import { lastSlugSegment, parseJsonRecord, uniqueResourceKey } from "./mail-draft.ts";
import type { TemplateRowSummary, TemplateRowView } from "./mail-types.ts";
import type { OverviewRowView } from "./overview-row.ts";
import { templateTitleText } from "./used-by-label.ts";

function pdfRowIdOf(summaries: readonly TemplateRowSummary[] | null, slug: string): string | null {
  const ofSlug = (summaries ?? []).filter((row) => row.slug === slug);
  return (ofSlug.find((row) => row.scope === "tenant") ?? ofSlug[0])?.id ?? null;
}

function PdfLinkForm({
  templates,
  variableLabels,
  templateId,
  takenKeys,
  onLinked,
}: {
  readonly templates: readonly OverviewRowView[];
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly templateId: string;
  readonly takenKeys: readonly string[];
  readonly onLinked: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Field, Input } = usePrimitives();
  const [slug, setSlug] = useState(templates[0]?.slug ?? "");
  const [editedName, setEditedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkPdf = useMutation(TemplateResolverHandlers.resourceLinkPdf);

  const summaries = useQuery<readonly TemplateRowSummary[]>(TemplateResolverQueries.list, {
    kind: "document-pdf",
    includeSystem: true,
  });
  const rowId = pdfRowIdOf(summaries.data, slug);
  const row = useQuery<TemplateRowView | null>(
    TemplateResolverQueries.findById,
    { id: rowId ?? "" },
    { enabled: rowId !== null },
  );
  const metaName = parseJsonRecord(row.data?.meta)["fileName"];
  const defaultName =
    typeof metaName === "string" && metaName !== "" ? metaName : `${lastSlugSegment(slug)}.pdf`;
  const fileName = editedName ?? defaultName;

  const link = async (): Promise<void> => {
    setError(null);
    const result = await linkPdf.mutate({
      templateId,
      key: uniqueResourceKey(lastSlugSegment(slug), takenKeys),
      templateSlug: slug,
      fileName,
    });
    if (!result.isSuccess) {
      setError(dispatcherErrorText(result.error, t));
      return;
    }
    onLinked();
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <Banner variant="error" testId="mail-pdf-link-error">
          {error}
        </Banner>
      )}
      <Field id="mail-pdf-template" label={t("documentDesigner.mail.pdfLink.template")}>
        <Input
          kind="select"
          id="mail-pdf-template"
          name="mail-pdf-template"
          value={slug}
          onChange={(next) => {
            setSlug(next);
            setEditedName(null);
          }}
          options={templates.map((template) => ({
            value: template.slug,
            label: templateTitleText(t, template.title),
          }))}
        />
      </Field>
      <Field
        id="mail-pdf-file-name"
        label={t("documentDesigner.mail.pdfLink.fileName")}
        description={t("documentDesigner.mail.pdfLink.fileNameHint")}
      >
        <PlaceholderLineEditor
          id="mail-pdf-file-name"
          value={fileName}
          onChange={setEditedName}
          variableLabels={variableLabels}
          aria-label={t("documentDesigner.mail.pdfLink.fileName")}
        />
      </Field>
      <div className="flex justify-end">
        <Button
          disabled={slug === "" || fileName === "" || linkPdf.pending}
          loading={linkPdf.pending}
          onClick={link}
          testId="mail-pdf-link-confirm"
        >
          {t("documentDesigner.mail.pdfLink.confirm")}
        </Button>
      </div>
    </div>
  );
}

export function PdfLinkModal({
  open,
  onOpenChange,
  templates,
  ...form
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly templates: readonly OverviewRowView[];
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly templateId: string;
  readonly takenKeys: readonly string[];
  readonly onLinked: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Modal } = usePrimitives();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("documentDesigner.mail.pdfLink.title")}
      testId="mail-pdf-link-modal"
    >
      {templates.length === 0 ? (
        <EmptyState title={t("documentDesigner.mail.pdfLink.none")} />
      ) : (
        <PdfLinkForm
          templates={templates}
          {...form}
          onLinked={() => {
            onOpenChange(false);
            form.onLinked();
          }}
        />
      )}
    </Modal>
  );
}
