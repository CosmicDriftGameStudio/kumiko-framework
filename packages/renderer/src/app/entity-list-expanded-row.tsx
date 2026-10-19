import type { RowActionDrawer } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { RelatedListSection } from "../components/related-list-section.tsx";
import { RenderEditActionButton } from "../components/render-edit-action-button.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import type {
  EditRelatedListSectionViewModel,
  ListRowViewModel,
  Translate,
} from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { useNav } from "./nav.tsx";
import { useReturnHost } from "./return-to.tsx";
import { buildRecordActions } from "./row-actions.ts";

// Content of an entityList row's expansion area: the row's record is the
// parent of a relatedList. `expansionNonce` in the key remounts the sub-list
// after a write that ran outside of it (drawer submit, title-row action).
export function EntityListExpandedRow({
  section,
  row,
  featureName,
  translate,
  expansionNonce,
  openDrawer,
  onAfterWrite,
  onSubListInvalidated,
}: {
  readonly section: EditRelatedListSectionViewModel;
  readonly row: ListRowViewModel;
  readonly featureName: string;
  readonly translate?: Translate;
  readonly expansionNonce: number;
  readonly openDrawer: (
    action: RowActionDrawer,
    initialValues: Readonly<Record<string, unknown>> | undefined,
  ) => void;
  /** Reloads the parent list after a write in the sub-list. */
  readonly onAfterWrite: () => void | Promise<void>;
  /** Asks the host to remount every open sub-list. */
  readonly onSubListInvalidated: () => void;
}): ReactNode {
  const { Banner, Button, Dialog } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  const host = useReturnHost();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const [actionError, setActionError] = useState<string | null>(null);

  const onTitleActionWritten = useCallback(async () => {
    onSubListInvalidated();
    await onAfterWrite();
  }, [onSubListInvalidated, onAfterWrite]);

  const titleActions = useMemo(
    () =>
      section.actions !== undefined && section.actions.length > 0
        ? buildRecordActions({
            actions: section.actions,
            record: row.values,
            translate: effectiveTranslate,
            nav,
            host,
            dispatcher,
            openDrawer,
            onWriteSuccess: onTitleActionWritten,
            clientActions,
          })
        : undefined,
    [
      section.actions,
      row.values,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer,
      onTitleActionWritten,
      clientActions,
    ],
  );
  const titleActionButtons: ReactNode = titleActions?.map((action) => (
    <RenderEditActionButton
      key={action.id}
      action={action}
      Button={Button}
      Dialog={Dialog}
      onError={setActionError}
    />
  ));

  return (
    <>
      {actionError !== null && (
        <Banner variant="error" testId={`row-${row.id}-expansion-action-error`}>
          {actionError}
        </Banner>
      )}
      <RelatedListSection
        key={expansionNonce}
        embedded
        section={section}
        parentId={String(row.values["id"] ?? row.id)}
        record={row.values}
        featureName={featureName}
        translate={effectiveTranslate}
        onOpenDrawer={openDrawer}
        onAfterWrite={onAfterWrite}
        {...(titleActionButtons !== undefined && { actions: titleActionButtons })}
      />
    </>
  );
}
