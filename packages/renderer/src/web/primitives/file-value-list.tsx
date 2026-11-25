import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { FileText } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type FileValueListProps, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Button } from "../ui/button.tsx";
import { PdfPreview } from "../widgets/pdf-preview.tsx";
import { fileOriginalUrl, useFileMeta } from "./file-thumbnail.tsx";

const PDF_MIME_TYPE = "application/pdf";

function FileValueRow({
  fileId,
  previewOpenInitially,
  downloadAsButton,
  boxed,
  testId,
}: {
  readonly fileId: string;
  readonly previewOpenInitially: boolean;
  readonly downloadAsButton: boolean;
  readonly boxed: boolean;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  const meta = useFileMeta(fileId);
  const [previewOpen, setPreviewOpen] = useState(previewOpenInitially);
  if (!isUuid(fileId)) return <span className="text-sm">{fileId}</span>;
  const downloadUrl = fileOriginalUrl(fileId);
  return (
    <li className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-3">
        {boxed && <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />}
        <span
          className={cn("min-w-0 truncate text-sm", boxed && "font-semibold")}
          {...(testId !== undefined && { "data-testid": `${testId}-name` })}
        >
          {meta?.fileName ?? fileId.slice(0, 8)}
        </span>
        <a
          href={downloadUrl}
          download={meta?.fileName ?? ""}
          className={
            downloadAsButton
              ? "ml-auto inline-flex h-8 items-center justify-center rounded-md border border-border-strong bg-card px-3 text-sm font-medium text-foreground hover:bg-accent max-md:h-11"
              : "text-primary text-sm underline underline-offset-2"
          }
          {...(testId !== undefined && { "data-testid": `${testId}-download` })}
        >
          {t("kumiko.field.file-list.download")}
        </a>
        {meta?.mimeType === PDF_MIME_TYPE && (
          <Button
            type="button"
            variant="link"
            size="sm"
            aria-expanded={previewOpen}
            onClick={() => setPreviewOpen((open) => !open)}
            {...(testId !== undefined && { "data-testid": `${testId}-preview-toggle` })}
          >
            {t(
              previewOpen ? "kumiko.field.file-list.hidePreview" : "kumiko.field.file-list.preview",
            )}
          </Button>
        )}
      </div>
      {previewOpen && meta?.mimeType === PDF_MIME_TYPE && (
        <PdfPreview source={{ url: downloadUrl }} testId={`file-preview-${fileId}`} />
      )}
    </li>
  );
}

export function FileValueList({
  fileIds,
  previewOpenByDefault = false,
  downloadAsButton = false,
  boxed = false,
  testId,
}: FileValueListProps): ReactNode {
  if (fileIds.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid={testId}>
      {fileIds.map((fileId, index) => (
        <FileValueRow
          key={fileId}
          fileId={fileId}
          previewOpenInitially={previewOpenByDefault && index === fileIds.length - 1}
          downloadAsButton={downloadAsButton}
          boxed={boxed}
          {...(testId !== undefined && { testId: `${testId}-${fileId}` })}
        />
      ))}
    </ul>
  );
}
