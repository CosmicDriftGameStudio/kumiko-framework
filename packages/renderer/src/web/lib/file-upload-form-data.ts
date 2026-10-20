export type FileUploadFormDataInput = {
  readonly file: Blob;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
  /** Screen QN of an actionForm: the upload is pending for that form's field, not for an entity. */
  readonly actionForm?: string | undefined;
};

export function buildFileUploadFormData(input: FileUploadFormDataInput): FormData {
  const formData = new FormData();
  formData.append("file", input.file);
  if (input.entityType !== undefined) formData.append("entityType", input.entityType);
  if (input.entityId !== undefined) formData.append("entityId", input.entityId);
  if (input.fieldName !== undefined) formData.append("fieldName", input.fieldName);
  if (input.actionForm !== undefined) formData.append("actionForm", input.actionForm);
  return formData;
}
