import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  useMutation,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useRef, useState } from "react";
import { fetchStoredFileName } from "./file-name.ts";
import { uniqueResourceKey } from "./mail-draft.ts";

const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export type UploadedResource = { readonly key: string; readonly purpose: "image" | "attachment" };

type UploadTarget = {
  readonly templateId: string;
  readonly takenKeys: readonly string[];
  readonly onUploaded: (uploaded: UploadedResource) => void;
};

function useResourceUpload(target: UploadTarget): {
  readonly upload: (
    fileRefId: string | null,
    purpose: UploadedResource["purpose"],
  ) => Promise<void>;
  readonly error: string | null;
  readonly busy: boolean;
} {
  const t = useTranslation();
  const resourceUpload = useMutation(TemplateResolverHandlers.resourceUpload);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // takenKeys only refreshes after the fire-and-forget row refetch, so keys handed out
  // here must be remembered or a quick second upload of the same file name collides.
  const uploadedKeys = useRef<{ templateId: string; keys: Set<string> }>({
    templateId: target.templateId,
    keys: new Set(),
  });

  const upload = async (
    fileRefId: string | null,
    purpose: UploadedResource["purpose"],
  ): Promise<void> => {
    if (fileRefId === null) return;
    setError(null);
    setBusy(true);
    try {
      const fileName = await fetchStoredFileName(fileRefId);
      if (fileName === null) {
        setError(t("documentDesigner.mail.upload.noFileName"));
        return;
      }
      if (uploadedKeys.current.templateId !== target.templateId) {
        uploadedKeys.current = { templateId: target.templateId, keys: new Set() };
      }
      const key = uniqueResourceKey(fileName, [...target.takenKeys, ...uploadedKeys.current.keys]);
      const result = await resourceUpload.mutate({
        sourceFileRefId: fileRefId,
        templateId: target.templateId,
        key,
        purpose,
        ...(purpose === "attachment" && { fileName }),
      });
      if (!result.isSuccess) {
        setError(dispatcherErrorText(result.error, t));
        return;
      }
      uploadedKeys.current.keys.add(key);
      target.onUploaded({ key, purpose });
    } finally {
      setBusy(false);
    }
  };
  return { upload, error, busy };
}

export function UploadModal({
  open,
  onOpenChange,
  target,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly target: UploadTarget;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Field, Input, Modal, Text } = usePrimitives();
  const { upload, error, busy } = useResourceUpload({
    ...target,
    onUploaded: (uploaded) => {
      onOpenChange(false);
      target.onUploaded(uploaded);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("documentDesigner.mail.upload.title")}
      testId="mail-upload-modal"
    >
      <div className="flex flex-col gap-4">
        {error !== null && (
          <Banner variant="error" testId="mail-upload-error">
            {error}
          </Banner>
        )}
        {busy && <Text variant="muted">{t("documentDesigner.mail.upload.busy")}</Text>}
        <Field
          id="mail-upload-image"
          label={t("documentDesigner.mail.upload.image")}
          description={t("documentDesigner.mail.upload.imageHint")}
        >
          <Input
            kind="file"
            id="mail-upload-image"
            name="mail-upload-image"
            value={null}
            accept={IMAGE_ACCEPT}
            disabled={busy}
            onChange={(fileId) => void upload(fileId, "image")}
          />
        </Field>
        <Field
          id="mail-upload-attachment"
          label={t("documentDesigner.mail.upload.attachment")}
          description={t("documentDesigner.mail.upload.attachmentHint")}
        >
          <Input
            kind="file"
            id="mail-upload-attachment"
            name="mail-upload-attachment"
            value={null}
            disabled={busy}
            onChange={(fileId) => void upload(fileId, "attachment")}
          />
        </Field>
      </div>
    </Modal>
  );
}
