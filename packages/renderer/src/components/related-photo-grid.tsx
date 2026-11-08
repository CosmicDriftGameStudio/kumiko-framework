import type { EditRelatedListSection } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { ErrorNotice } from "../app/error-reference.tsx";
import { fileIdsOf } from "../file-ids-of.ts";
import type { ListRowViewModel } from "../headless/index.ts";
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
  const { PhotoGrid, Button, Dialog } = usePrimitives();
  if (PhotoGrid === undefined) return null;
  const { imageField, captionField } = photoGrid;
  return (
    <PhotoGrid
      {...(testId !== undefined && { testId })}
      tiles={rows.map((row, index) => {
        const vm = viewModelOf(row);
        const caption = captionField === undefined ? undefined : row[captionField];
        const imageId = fileIdsOf(row[imageField])[0];
        return {
          id: vm.id === "" ? String(index) : vm.id,
          ...(imageId !== undefined && { imageId }),
          ...(typeof caption === "string" && caption !== "" && { caption }),
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
