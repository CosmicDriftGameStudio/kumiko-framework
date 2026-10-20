// Drop zone for a `files` / `images` field with `display: "dropzone"`: one status row per picked
// file, the field value is the array of FileRef ids of the files that uploaded. Failed files stay
// out of the value; removing a row removes its id.

import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "../../index.ts";
import { FileCountLimitError, uploadErrorKey } from "../lib/upload-error-key.ts";
import { type FileRefTarget, uploadFileRef } from "../lib/upload-file-ref.ts";
import { UploadZone } from "../widgets/upload-zone.tsx";

export type FilesDropzoneInputProps = {
  readonly id: string;
  readonly value: readonly string[];
  readonly onChange: (fileIds: readonly string[]) => void;
  readonly accept?: readonly string[];
  readonly maxSize?: string;
  readonly maxCount?: number;
  readonly disabled?: boolean;
  readonly entityType?: string;
  readonly uploadActionForm?: string;
  readonly entityId?: string;
  readonly fieldName?: string;
  readonly testId?: string;
};

export function FilesDropzoneInput({
  id,
  value,
  onChange,
  accept,
  maxSize,
  maxCount,
  disabled,
  entityType,
  uploadActionForm,
  entityId,
  fieldName,
  testId,
}: FilesDropzoneInputProps): ReactNode {
  const t = useTranslation();
  // Uploads of one batch finish independently; building each next value from the render's
  // `value` would drop the ids of the others. Re-synced whenever the owner changes the value.
  const latestIds = useRef(value);
  const uploadsRunning = useRef(0);
  useEffect(() => {
    latestIds.current = value;
  }, [value]);

  const target: FileRefTarget = {
    entityType,
    entityId,
    fieldName,
    actionForm: uploadActionForm,
  };

  async function uploadOne(file: File): Promise<string> {
    if (maxCount !== undefined && latestIds.current.length + uploadsRunning.current >= maxCount) {
      throw new FileCountLimitError();
    }
    uploadsRunning.current += 1;
    try {
      const fileId = await uploadFileRef(file, target);
      latestIds.current = [...latestIds.current, fileId];
      onChange(latestIds.current);
      return fileId;
    } finally {
      uploadsRunning.current -= 1;
    }
  }

  function removeOne(fileId: string): void {
    latestIds.current = latestIds.current.filter((existing) => existing !== fileId);
    onChange(latestIds.current);
  }

  const limits = [
    accept !== undefined && accept.length > 0 ? accept.join(", ").toUpperCase() : undefined,
    maxSize !== undefined ? t("kumiko.field.dropzone.limit-size", { size: maxSize }) : undefined,
    maxCount !== undefined
      ? t("kumiko.field.dropzone.limit-count", { count: maxCount })
      : undefined,
  ].filter((part): part is string => part !== undefined);

  return (
    <UploadZone
      testId={testId ?? `${id}-dropzone`}
      title={t("kumiko.field.dropzone.title")}
      {...(limits.length > 0 && { hint: limits.join(" · ") })}
      {...(accept !== undefined && { accept })}
      {...(disabled !== undefined && { disabled })}
      doneValues={value}
      onUpload={uploadOne}
      onRemove={removeOne}
      describeError={(cause) => t(uploadErrorKey(cause), { count: maxCount })}
    />
  );
}
