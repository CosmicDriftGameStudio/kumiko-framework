export type FileUploadFormDataInput = {
  readonly file: Blob;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
};

export function buildFileUploadFormData(input: FileUploadFormDataInput): FormData {
  const formData = new FormData();
  formData.append("file", input.file);
  if (input.entityType !== undefined) formData.append("entityType", input.entityType);
  if (input.entityId !== undefined) formData.append("entityId", input.entityId);
  if (input.fieldName !== undefined) formData.append("fieldName", input.fieldName);
  return formData;
}
