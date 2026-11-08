import type { EditRelatedListSection } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { ErrorNotice } from "../app/error-reference.tsx";
import { fileIdsOf } from "../file-ids-of.ts";
import type { ListRowViewModel } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { type DataTableRowAction, usePrimitives } from "../primitives.tsx";
import { RenderEditActionButton } from "./render-edit-action-button.tsx";

function viewModelOf(row: Readonly<Record<string, unknown>>): ListRowViewModel {
  return { id: String(row["id"] ?? ""), values: row };
}

// One tile per row: the row's image and its row actions as buttons. The same
// DataTableRowAction list the table would get, so confirm and visibility behave alike.
export function RelatedPhotoGrid({
  rows,
  photoGrid,
  rowActions,
  onActionError,
  testId,
}: {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly photoGrid: NonNullable<EditRelatedListSection["photoGrid"]>;
  readonly rowActions: readonly DataTableRowAction[] | undefined;
  readonly onActionError: (notice: ErrorNotice | null) => void;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  const { PhotoGrid, Button, Dialog } = usePrimitives();
  if (PhotoGrid === undefined) return null;
  const { imageField, captionField, badgeField } = photoGrid;
  const leadsOnNarrow = (row: (typeof rows)[number]): boolean => {
    if (photoGrid.badgeFirst !== true || badgeField === undefined) return false;
    const value = row[badgeField];
    return typeof value === "string" && value !== "";
  };
  return (
    <PhotoGrid
      {...(testId !== undefined && { testId })}
      tiles={rows.map((row, index) => {
        const vm = viewModelOf(row);
        const captionValue = captionField === undefined ? undefined : row[captionField];
        const caption =
          typeof captionValue === "string" && captionValue !== ""
            ? captionValue
            : t("kumiko.photo-grid.fallback-caption", { n: index + 1 });
        const badge = badgeField === undefined ? undefined : row[badgeField];
        const imageId = fileIdsOf(row[imageField])[0];
        return {
          id: vm.id === "" ? String(index) : vm.id,
          ...(imageId !== undefined && { imageId }),
          caption,
          ...(typeof badge === "string" && badge !== "" && { badge }),
          ...(leadsOnNarrow(row) && { leadsOnNarrow: true as const }),
          actions: (rowActions ?? [])
            .filter((action) => action.isVisible?.(vm) !== false)
            .map((action) => (
              <RenderEditActionButton
                key={action.id}
                action={{
                  id: action.id,
                  label: action.label,
                  onPress: () => action.onTrigger(vm),
                  ...(action.style !== undefined && { style: action.style }),
                  ...(action.display !== undefined && { display: action.display }),
                  ...(action.confirm !== undefined && { confirm: action.confirm }),
                  ...(action.confirmLabel !== undefined && { confirmLabel: action.confirmLabel }),
                  ...(action.confirmRequired !== undefined && {
                    confirmRequired: action.confirmRequired,
                  }),
                  ...(action.icon !== undefined && { icon: action.icon }),
                }}
                Button={Button}
                Dialog={Dialog}
                onError={onActionError}
              />
            )),
        };
      })}
    />
  );
}
