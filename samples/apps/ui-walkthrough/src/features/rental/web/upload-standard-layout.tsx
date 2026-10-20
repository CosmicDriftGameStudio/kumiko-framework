import { FormScreenLayout, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { UploadZone, uploadFileRef } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";

type UploadedReceipt = { readonly id: string; readonly name: string };

export function UploadStandardLayout(): ReactNode {
  const t = useTranslation();
  const { Section, Button, Text } = usePrimitives();
  const [uploadedReceipts, setUploadedNames] = useState<readonly UploadedReceipt[]>([]);

  async function uploadReceipt(file: File): Promise<void> {
    await uploadFileRef(file);
    setUploadedNames((receipts) => [...receipts, { id: crypto.randomUUID(), name: file.name }]);
  }

  return (
    <FormScreenLayout
      testId="upload-standard-layout"
      description={t("rental.upload.description")}
      actions={
        uploadedReceipts.length > 0 ? (
          <Button testId="upload-to-review">{t("rental.upload.toReview")}</Button>
        ) : undefined
      }
    >
      <Section
        title={t("rental.upload.zoneTitle")}
        icon="upload"
        subtitle={t("rental.upload.zoneDescription")}
        testId="upload-zone-section"
      >
        <UploadZone
          testId="upload-zone"
          title={t("rental.upload.dropTitle")}
          hint={t("rental.upload.dropHint")}
          accept={["application/pdf", "image/*"]}
          onUpload={uploadReceipt}
        />
      </Section>
      <Section
        title={t("rental.upload.resultTitle")}
        icon="file"
        subtitle={t("rental.upload.resultDescription")}
        testId="upload-result-section"
      >
        {uploadedReceipts.length === 0 ? (
          <Text variant="muted">{t("rental.upload.empty")}</Text>
        ) : (
          <ul data-testid="upload-result-list" className="space-y-2">
            {uploadedReceipts.map(({ id, name }) => (
              <li key={id} className="text-sm">
                {name}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </FormScreenLayout>
  );
}
