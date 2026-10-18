// Editor-agnostic chip bar for a content editor's declared variables
// (ContentCollectionDefinition.variableSchema). Renders next to the text
// surface, never inside it — step 3 (rich/tiptap) reuses this same bar over
// a different editor, so it must not assume a textarea underneath.

import { Fragment, type ReactNode } from "react";
import { useTranslation } from "../i18n.js";
import { usePrimitives } from "../primitives.js";

export type VariableChipsProps = {
  readonly variables: readonly string[];
  readonly onInsert: (name: string) => void;
  readonly disabled?: boolean;
  /** Display text per variable name; a named chip keeps the raw name as tooltip. */
  readonly labels?: Readonly<Record<string, string>>;
};

// No wrapping element: @cosmicdrift/kumiko-renderer is DOM-free (native impls
// have no <div>), and layout is a platform concern anyway — the caller
// (PlainContentEditor et al.) places these buttons in its own container.
export function VariableChips({
  variables,
  onInsert,
  disabled,
  labels,
}: VariableChipsProps): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  return (
    <Fragment>
      {variables.map((name) => {
        const label =
          labels !== undefined && Object.hasOwn(labels, name) ? labels[name] : undefined;
        return (
          <Button
            key={name}
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => onInsert(name)}
            ariaLabel={t("kumiko.contentEditor.insertVariable", { name: label ?? name })}
            {...(label !== undefined && { title: name })}
          >
            {label ?? `{{${name}}}`}
          </Button>
        );
      })}
    </Fragment>
  );
}
