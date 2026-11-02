import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { type ReactNode, useState } from "react";
import { useTranslation } from "../../index.ts";
import { Button } from "../ui/button.tsx";
import { PdfPreview } from "../widgets/pdf-preview.tsx";
import { DefaultDrawer } from "./drawer.tsx";
import { fileOriginalUrl, useFileMeta } from "./file-thumbnail.tsx";

const PDF_MIME_TYPE = "application/pdf";

/** "View" action for a stored file: renders only for PDFs and opens the viewer in a drawer.
 *  The MIME type comes from `useFileMeta`, so a list of rows costs one batched meta request. */
export function FileViewAction({ fileId }: { readonly fileId: string }): ReactNode {
  const t = useTranslation();
  const meta = useFileMeta(fileId);
  const [open, setOpen] = useState(false);
  if (!isUuid(fileId) || meta?.mimeType !== PDF_MIME_TYPE) return null;
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid={`file-view-${fileId}`}
      >
        {t("kumiko.field.file-list.view")}
      </Button>
      <DefaultDrawer
        open={open}
        onOpenChange={setOpen}
        title={meta.fileName}
        testId={`file-view-drawer-${fileId}`}
      >
        <div className="min-h-0 flex-1">
          <PdfPreview
            variant="viewer"
            fill
            source={{ url: fileOriginalUrl(fileId) }}
            testId={`file-view-pdf-${fileId}`}
          />
        </div>
      </DefaultDrawer>
    </>
  );
}
