type StateInput = {
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
};

type LocaleBoundsInput = {
  readonly locale?: string;
  readonly min?: string;
  readonly max?: string;
};

type UploadTargetInput = {
  readonly entityType?: string;
  readonly uploadActionForm?: string;
  readonly entityId?: string;
  readonly fieldName?: string;
  readonly subField?: string;
};

// The inputs below take optional props that must be absent, not `undefined`,
// so a primitive's own defaults still apply.
export function stateProps({ disabled, required, hasError }: StateInput): StateInput {
  return {
    ...(disabled !== undefined && { disabled }),
    ...(required !== undefined && { required }),
    ...(hasError !== undefined && { hasError }),
  };
}

export function localeBoundsProps({ locale, min, max }: LocaleBoundsInput): LocaleBoundsInput {
  return {
    ...(locale !== undefined && { locale }),
    ...(min !== undefined && { min }),
    ...(max !== undefined && { max }),
  };
}

export function uploadTargetProps({
  entityType,
  uploadActionForm,
  entityId,
  fieldName,
  subField,
}: UploadTargetInput): UploadTargetInput {
  return {
    ...(entityType !== undefined && { entityType }),
    ...(uploadActionForm !== undefined && { uploadActionForm }),
    ...(entityId !== undefined && { entityId }),
    ...(fieldName !== undefined && { fieldName }),
    ...(subField !== undefined && { subField }),
  };
}
