import { type ReactNode, useState } from "react";
import { usePrimitives } from "../primitives.js";
import { RenderEditActionButton } from "./render-edit-action-button.js";
import type { RenderEditAction } from "./render-edit-types.js";

export type ListEmptyStateContent = {
  readonly title: string;
  readonly description?: string;
  readonly action?: RenderEditAction;
};

export function ListEmptyStateBody({
  content,
  narrowed,
  createButton,
  translate,
}: {
  readonly content: ListEmptyStateContent | undefined;
  /** A search term or changed filter produced the empty result, so "create the first one" would mislead. */
  readonly narrowed: boolean;
  readonly createButton: ReactNode;
  readonly translate: (key: string) => string;
}): ReactNode {
  const { Text, Button, Dialog, Banner } = usePrimitives();
  const [actionError, setActionError] = useState<string | null>(null);
  if (narrowed) return <Text>{translate("kumiko.list.empty.filtered")}</Text>;
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
          {actionError}
        </Banner>
      )}
      {createButton}
    </>
  );
}
