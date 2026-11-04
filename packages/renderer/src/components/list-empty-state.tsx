import { type ReactNode, useState } from "react";
import { type ErrorNotice, ErrorReference } from "../app/error-reference.tsx";
import { usePrimitives } from "../primitives.tsx";
import { RenderEditActionButton } from "./render-edit-action-button.tsx";
import type { RenderEditAction } from "./render-edit-types.ts";

export type ListEmptyStateContent = {
  readonly title: string;
  readonly description?: string;
  readonly action?: RenderEditAction;
};

export type NamedFilterEmptyContent = {
  readonly title: string;
  readonly description?: string;
  readonly onReset: () => void;
};

export function ListEmptyStateBody({
  content,
  narrowed,
  namedFilterEmpty,
  defaultFilterActive = false,
  onShowAll,
  createButton,
  translate,
}: {
  readonly content: ListEmptyStateContent | undefined;
  /** A search term or changed filter produced the empty result, so "create the first one" would mislead. */
  readonly narrowed: boolean;
  /** The active named filter has its own empty sentence; shown instead of the generic "no matches" text. */
  readonly namedFilterEmpty?: NamedFilterEmptyContent | undefined;
  /** A default filter is on and nothing else narrows: rows may exist outside it. */
  readonly defaultFilterActive?: boolean;
  readonly onShowAll?: () => void;
  readonly createButton: ReactNode;
  readonly translate: (key: string) => string;
}): ReactNode {
  const { Text, Button, Dialog, Banner } = usePrimitives();
  const [actionError, setActionError] = useState<ErrorNotice | null>(null);
  if (narrowed && namedFilterEmpty !== undefined) {
    return (
      <>
        <Text>{namedFilterEmpty.title}</Text>
        {namedFilterEmpty.description !== undefined && (
          <Text variant="small">{namedFilterEmpty.description}</Text>
        )}
        <Button
          variant="secondary"
          onClick={namedFilterEmpty.onReset}
          testId="render-list-empty-reset-filter"
        >
          {translate("kumiko.list.empty.resetFilter")}
        </Button>
      </>
    );
  }
  if (narrowed) return <Text>{translate("kumiko.list.empty.filtered")}</Text>;
  if (defaultFilterActive) {
    return (
      <>
        <Text>{translate("kumiko.list.empty.defaultFiltered")}</Text>
        {onShowAll !== undefined && (
          <Button variant="secondary" onClick={onShowAll} testId="render-list-empty-show-all">
            {translate("kumiko.list.empty.showAll")}
          </Button>
        )}
      </>
    );
  }
  const description =
    content === undefined ? translate("kumiko.list.empty.hint") : content.description;
  return (
    <>
      <Text>{content?.title ?? translate("kumiko.list.empty.title")}</Text>
      {description !== undefined && <Text variant="small">{description}</Text>}
      {content?.action !== undefined && (
        <RenderEditActionButton
          action={content.action}
          Button={Button}
          Dialog={Dialog}
          onError={setActionError}
        />
      )}
      {actionError !== null && (
        <Banner variant="error" testId="render-list-empty-state-action-error">
          {actionError.message}
          <ErrorReference requestId={actionError.requestId} />
        </Banner>
      )}
      {createButton}
    </>
  );
}
