import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Translate } from "../headless/index.ts";
import type { ActionMenuItemSpec, usePrimitives } from "../primitives.tsx";
import { ListEmptyStateBody, type ListEmptyStateContent } from "./list-empty-state.tsx";
import { ListHeaderSlotMount } from "./render-list-header-slot.tsx";
import { ToolbarActionView } from "./render-list-toolbar-action.tsx";
import type { ToolbarActionSplit } from "./render-list-toolbar-model.ts";

type Primitives = ReturnType<typeof usePrimitives>;

export type ListToolbarModel = {
  readonly screen: EntityListScreenDefinition;
  readonly Button: Primitives["Button"];
  readonly Dialog: Primitives["Dialog"];
  readonly Banner: Primitives["Banner"];
  readonly onCreate: (() => void) | undefined;
  readonly createInPageHeader: boolean;
  readonly pageHeaderCompact: boolean;
  readonly effectiveCreateLabel: string;
  readonly split: ToolbarActionSplit;
};

export function renderCreateButton(model: ListToolbarModel): ReactNode {
  const { Button, onCreate, createInPageHeader, pageHeaderCompact, effectiveCreateLabel } = model;
  return onCreate !== undefined && createInPageHeader && pageHeaderCompact ? (
    <Button
      variant="primary"
      icon="plus"
      size="icon"
      ariaLabel={effectiveCreateLabel}
      title={effectiveCreateLabel}
      onClick={onCreate}
      testId="render-list-create"
    />
  ) : onCreate !== undefined ? (
    <Button
      variant="primary"
      icon="plus"
      onClick={onCreate}
      testId="render-list-create"
      className="px-3.5"
    >
      {effectiveCreateLabel}
    </Button>
  ) : undefined;
}

export function renderHeaderActions(model: ListToolbarModel, createButton: ReactNode): ReactNode {
  const { Button, Dialog, Banner, createInPageHeader, pageHeaderCompact, split } = model;
  const { promotedToolbarActions, promotedInOverflowMenu } = split;
  return promotedToolbarActions.length > 0 && !promotedInOverflowMenu ? (
    <>
      {promotedToolbarActions.map((a) => (
        <ToolbarActionView
          key={a.id}
          action={pageHeaderCompact ? { ...a, icon: a.icon ?? "plus" } : a}
          iconOnly={pageHeaderCompact}
          Button={Button}
          Dialog={Dialog}
          Banner={Banner}
        />
      ))}
      {createInPageHeader && createButton}
    </>
  ) : createInPageHeader ? (
    createButton
  ) : undefined;
}

export function renderToolbarEnd(model: ListToolbarModel, createButton: ReactNode): ReactNode {
  const { screen, Button, Dialog, Banner, onCreate, createInPageHeader, split } = model;
  const { toolbarActionsInToolbar, hasToolbarActionsInToolbar, toolbarIconOnly } = split;
  const hasHeaderSlot = screen.slots?.header !== undefined;
  return hasHeaderSlot ||
    hasToolbarActionsInToolbar ||
    (onCreate !== undefined && !createInPageHeader) ? (
    <>
      {hasHeaderSlot && <ListHeaderSlotMount screen={screen} />}
      {hasToolbarActionsInToolbar &&
        toolbarActionsInToolbar.map((a) => (
          <ToolbarActionView
            key={a.id}
            action={a}
            iconOnly={toolbarIconOnly}
            Button={Button}
            Dialog={Dialog}
            Banner={Banner}
          />
        ))}
      {!createInPageHeader && createButton}
    </>
  ) : undefined;
}

export function renderSearchInput(
  Input: Primitives["Input"],
  localQ: string,
  setLocalQ: (next: string) => void,
  placeholder: string,
): ReactNode {
  return (
    <Input
      kind="text"
      id="render-list-search"
      name="search"
      value={localQ}
      onChange={setLocalQ}
      placeholder={placeholder}
    />
  );
}

type EmptyStateModel = {
  readonly Button: Primitives["Button"];
  readonly emptyState: ReactNode;
  readonly onCreate: (() => void) | undefined;
  readonly emptyContent: ListEmptyStateContent | undefined;
  readonly narrowed: boolean;
  readonly defaultFilterActive: boolean;
  readonly onFilterReset: (() => void) | undefined;
  readonly translate: Translate;
  readonly createInPageHeader: boolean;
  readonly effectiveCreateLabel: string;
};

// Empty state: by default, show a heading, description, and optional CTA
// button. The caller can replace it completely through emptyState.
// Without onCreate or an override, DataTable uses its default
// (`kumiko.list.no-entries`).
export function composeEmptyState(model: EmptyStateModel): ReactNode {
  const {
    Button,
    emptyState,
    onCreate,
    emptyContent,
    narrowed,
    defaultFilterActive,
    onFilterReset,
    translate,
    createInPageHeader,
    effectiveCreateLabel,
  } = model;
  return (
    emptyState ??
    (onCreate !== undefined || emptyContent !== undefined || narrowed || defaultFilterActive ? (
      <ListEmptyStateBody
        content={emptyContent}
        narrowed={narrowed}
        defaultFilterActive={defaultFilterActive}
        {...(onFilterReset !== undefined && { onShowAll: onFilterReset })}
        translate={translate}
        createButton={
          onCreate !== undefined && !narrowed && !defaultFilterActive && !createInPageHeader ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={onCreate}
              testId="render-list-empty-create"
            >
              {effectiveCreateLabel}
            </Button>
          ) : undefined
        }
      />
    ) : undefined)
  );
}

export function renderPageHeader(
  PageHeader: NonNullable<Primitives["PageHeader"]>,
  headerActions: ReactNode,
  promotedInOverflowMenu: boolean,
  promotedMenuItems: readonly ActionMenuItemSpec[],
): ReactNode {
  return (
    <PageHeader
      actions={headerActions}
      {...(promotedInOverflowMenu && { overflowItems: promotedMenuItems })}
    />
  );
}

export function renderMenuActionError(
  Banner: Primitives["Banner"],
  menuActionError: string,
): ReactNode {
  return (
    <Banner variant="error" testId="render-list-toolbar-action-error">
      {menuActionError}
    </Banner>
  );
}
