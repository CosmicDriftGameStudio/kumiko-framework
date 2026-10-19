import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import { useMemo } from "react";
import type { RenderEditAction } from "../components/render-edit-types.ts";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { useNav } from "./nav.tsx";
import { useReturnHost } from "./return-to.tsx";
import { buildRecordActions } from "./row-actions.ts";

const NO_DRAWER = (): void => {};

/** Header actions on a record shown by a screen that has no drawer host
 *  (dashboards): writeHandler, navigate and clientAction, `onWriteSuccess` after a success. */
export function useRecordActions(options: {
  readonly actions: readonly RowAction[] | undefined;
  readonly record: Readonly<Record<string, unknown>>;
  readonly recordId: string;
  readonly translate: Translate;
  readonly onWriteSuccess: () => void | Promise<void>;
}): readonly RenderEditAction[] | undefined {
  const { actions, record, recordId, translate, onWriteSuccess } = options;
  const nav = useNav();
  const host = useReturnHost();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  return useMemo(
    () =>
      actions === undefined
        ? undefined
        : buildRecordActions({
            actions,
            record,
            translate,
            nav,
            host,
            dispatcher,
            openDrawer: NO_DRAWER,
            onWriteSuccess,
            defaultWritePayloadId: recordId,
            clientActions,
          }),
    [actions, record, recordId, translate, nav, host, dispatcher, onWriteSuccess, clientActions],
  );
}
