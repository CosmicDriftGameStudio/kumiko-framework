import type { PlatformComponent } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { FormValues } from "../headless/index.ts";
import type { ActionMenuItemSpec } from "../primitives.tsx";
import { EditSlotMount } from "./edit-mounts.tsx";
import { RenderEditActionButton } from "./render-edit-action-button.tsx";
import { resolveExtensionEntityId } from "./render-edit-logic.ts";
import type { RenderEditModel } from "./render-edit-render-model.ts";

export type HeaderActionsModel = {
  readonly headerMenuItems: readonly ActionMenuItemSpec[];
  readonly secondaryFormActions: ReactNode;
  readonly formHeaderRegion: ReactNode;
  readonly titleActionMount: ReactNode;
};

function copyLinkMenuItems<TValues extends FormValues, TCtx>({
  engine: { props, state },
}: RenderEditModel<TValues, TCtx>): readonly ActionMenuItemSpec[] {
  const { onCopyLink } = props;
  if (onCopyLink === undefined) return [];
  return [
    {
      id: "copy-link",
      label: state.translate(
        state.linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink",
      ),
      icon: "link" as const,
      onSelect: () => {
        void Promise.resolve(onCopyLink()).then(() => state.setLinkCopied(true));
      },
    },
  ];
}

function cancelMenuItems<TValues extends FormValues, TCtx>({
  engine: { props, state },
  layout,
}: RenderEditModel<TValues, TCtx>): readonly ActionMenuItemSpec[] {
  const { onCancel } = props;
  if (!layout.cancelInHeaderMenu || onCancel === undefined) return [];
  return [
    {
      id: "cancel",
      label: state.translate("kumiko.actions.cancel"),
      icon: "x" as const,
      onSelect: () => onCancel(),
    },
  ];
}

function deleteMenuItems<TValues extends FormValues, TCtx>({
  engine: { props, state },
}: RenderEditModel<TValues, TCtx>): readonly ActionMenuItemSpec[] {
  if (props.onDelete === undefined) return [];
  return [
    {
      id: "delete",
      label: state.translate("kumiko.actions.delete"),
      icon: "trash" as const,
      variant: "danger" as const,
      onSelect: () => state.setConfirmDeleteOpen(true),
    },
  ];
}

function buildHeaderMenuItems<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): readonly ActionMenuItemSpec[] {
  if (!model.layout.menuPageHeaderActions) return [];
  const { menuActions } = model.engine.props;
  return [
    ...(menuActions ?? []).map(model.engine.state.menuActionToItem),
    ...copyLinkMenuItems(model),
    ...cancelMenuItems(model),
    ...deleteMenuItems(model),
  ];
}

function renderDeleteButton<TValues extends FormValues, TCtx>({
  engine: { props, state },
  layout,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  return (
    props.onDelete !== undefined &&
    !layout.menuPageHeaderActions && (
      <Button
        type="button"
        variant="danger-ghost"
        icon="trash"
        testId="render-edit-delete"
        disabled={props.disabled}
        onClick={() => state.setConfirmDeleteOpen(true)}
      >
        {state.translate("kumiko.actions.delete")}
      </Button>
    )
  );
}

function renderCopyLinkButton<TValues extends FormValues, TCtx>({
  engine: { props, state },
  layout,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  const { onCopyLink } = props;
  const { iconOnlyMidActions } = layout;
  const { translate, linkCopied } = state;
  return (
    onCopyLink !== undefined &&
    !layout.menuPageHeaderActions && (
      <Button
        type="button"
        variant={iconOnlyMidActions ? "secondary" : "link"}
        icon={linkCopied ? "check" : "link"}
        testId="render-edit-copy-link"
        {...(iconOnlyMidActions && {
          size: "icon" as const,
          ariaLabel: translate(
            linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink",
          ),
        })}
        onClick={async () => {
          await onCopyLink();
          state.setLinkCopied(true);
        }}
      >
        {iconOnlyMidActions
          ? null
          : translate(linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink")}
      </Button>
    )
  );
}

function renderCustomActions<TValues extends FormValues, TCtx>({
  engine: { props, state },
  layout,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button, Dialog } = state.primitives;
  return props.actions?.map((action) => (
    <RenderEditActionButton
      key={action.id}
      action={action}
      iconOnly={layout.iconOnlyMidActions}
      Button={Button}
      Dialog={Dialog}
      onError={state.setActionError}
    />
  ));
}

function renderMenuActionButtons<TValues extends FormValues, TCtx>({
  engine: { props, state },
  layout,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button, Dialog } = state.primitives;
  return (
    !layout.menuPageHeaderActions &&
    props.menuActions?.map((action) => (
      <RenderEditActionButton
        key={action.id}
        action={action}
        Button={Button}
        Dialog={Dialog}
        onError={state.setActionError}
      />
    ))
  );
}

function renderCancelButton<TValues extends FormValues, TCtx>({
  engine: { props, state },
  layout,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  const { onCancel } = props;
  return (
    onCancel !== undefined &&
    !layout.cancelInHeaderMenu && (
      <Button
        type="button"
        variant="secondary"
        onClick={() => onCancel()}
        testId="render-edit-cancel"
      >
        {state.translate("kumiko.actions.cancel")}
      </Button>
    )
  );
}

function renderSecondaryFormActions<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  return (
    <>
      {renderDeleteButton(model)}
      {renderCopyLinkButton(model)}
      {renderCustomActions(model)}
      {renderMenuActionButtons(model)}
      {renderCancelButton(model)}
    </>
  );
}

function renderEditSlot<TValues extends FormValues, TCtx>(
  { engine: { props, form, sections } }: RenderEditModel<TValues, TCtx>,
  slot: PlatformComponent | undefined,
  slotName: "header" | "titleAction",
): ReactNode {
  if (slot === undefined) return undefined;
  return (
    <EditSlotMount
      slot={slot}
      slotName={slotName}
      screenId={props.screen.id}
      entityName={sections.vm.entityName}
      entityId={resolveExtensionEntityId(props.entityId, sections.vm.id)}
      values={form.snapshot.values}
    />
  );
}

// A function headerRegion places the slot itself (projectionDetail puts it
// into its header card next to the actions); otherwise the slot renders
// above the caller's own headerRegion.
function placeHeaderSlot(
  headerRegion: ReactNode | ((headerSlot: ReactNode | undefined) => ReactNode),
  headerSlotMount: ReactNode,
): ReactNode {
  if (typeof headerRegion === "function") return headerRegion(headerSlotMount);
  if (headerSlotMount === undefined) return headerRegion;
  return (
    <>
      {headerSlotMount}
      {headerRegion}
    </>
  );
}

export function buildHeaderActions<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): HeaderActionsModel {
  const { props } = model.engine;
  const headerSlotMount = renderEditSlot(model, props.screen.slots?.header, "header");
  return {
    headerMenuItems: buildHeaderMenuItems(model),
    secondaryFormActions: renderSecondaryFormActions(model),
    formHeaderRegion: placeHeaderSlot(props.headerRegion, headerSlotMount),
    titleActionMount: renderEditSlot(model, props.screen.slots?.titleAction, "titleAction"),
  };
}
