import { ValidationError } from "../../errors/index.ts";

export const EXPORT_TOO_MANY_I18N_KEY = "kumiko.list.export-too-many";

export type ExportRejectReason =
  | "export_invalid_request"
  | "export_unknown_screen"
  | "export_not_enabled"
  | "export_unknown_column"
  | "export_no_columns";

export function exportRejection(
  reason: ExportRejectReason,
  path: string,
  params?: Readonly<Record<string, unknown>>,
): ValidationError {
  return new ValidationError({
    fields: [
      {
        path,
        code: reason,
        i18nKey: `kumiko.list.${reason.replace(/_/g, "-")}`,
        ...(params !== undefined && { params }),
      },
    ],
  });
}
