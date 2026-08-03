// Editor-agnostic chip bar for a content editor's declared variables
// (ContentCollectionDefinition.variableSchema). Renders next to the text
// surface, never inside it — step 3 (rich/tiptap) reuses this same bar over
// a different editor, so it must not assume a textarea underneath.

import { Fragment, type ReactNode } from "react";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";

export type VariableChipsProps = {
  readonly variables: readonly string[];
  readonly onInsert: (name: string) => void;
  readonly disabled?: boolean;
};

// No wrapping element: @cosmicdrift/kumiko-renderer is DOM-free (native impls
// have no <div>), and layout is a platform concern anyway — the caller
// (PlainContentEditor et al.) places these buttons in its own container.
export function VariableChips({ variables, onInsert, disabled }: VariableChipsProps): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  return (
    <Fragment>
      {variables.map((name) => (
        <Button
          key={name}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onInsert(name)}
          ariaLabel={t("kumiko.contentEditor.insertVariable", { name })}
        >
          {`{{${name}}}`}
        </Button>
      ))}
    </Fragment>
  );
}
