import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { Editor } from "@tiptap/core";
import { type ReactNode, useState } from "react";
import { PANEL_FIELDS } from "./document-insert-fields.tsx";
import { chosenNamesOf, type PanelModel, panelActionProps } from "./document-insert-model.ts";
import type { PanelKind } from "./document-tiptap-helpers.ts";

function PanelActions({
  onInsert,
  onRemoveLink,
  onCancel,
}: {
  readonly onInsert?: () => void;
  readonly onRemoveLink?: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  return (
    <div className="flex gap-2">
      {onInsert && (
        <Button type="button" size="sm" onClick={onInsert}>
          {t("template-resolver.documentEditor.insert")}
        </Button>
      )}
      {onRemoveLink && (
        <Button type="button" size="sm" variant="danger-ghost" onClick={onRemoveLink}>
          {t("template-resolver.documentEditor.removeLink")}
        </Button>
      )}
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
        {t("template-resolver.documentEditor.cancel")}
      </Button>
    </div>
  );
}

type PanelProps = {
  readonly editor: Editor;
  readonly editorId: string;
  readonly kind: PanelKind;
  readonly variables: readonly string[];
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly onClose: () => void;
};

export function InsertPanel({
  editor,
  editorId,
  kind,
  variables,
  variableLabels,
  onClose,
}: PanelProps): ReactNode {
  const { Button, Field, Input } = usePrimitives();
  const t = useTranslation();
  const [href, setHref] = useState(() => {
    const current = editor.getAttributes("link")["href"];
    return typeof current === "string" ? current : "";
  });
  const [resource, setResource] = useState("");
  const [alt, setAlt] = useState("");
  const [buttonText, setButtonText] = useState(() =>
    t("template-resolver.documentEditor.buttonDefaultText"),
  );
  const [stepsText, setStepsText] = useState(() =>
    t("template-resolver.documentEditor.stepsDefault"),
  );
  const [chosenName, setChosenName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const model: PanelModel = {
    t,
    Button,
    Field,
    Input,
    editor,
    kind,
    idPrefix: `${editorId}-panel`,
    variableLabels,
    onClose,
    href,
    setHref,
    resource,
    setResource,
    alt,
    setAlt,
    buttonText,
    setButtonText,
    stepsText,
    setStepsText,
    setChosenName,
    setError,
    ...chosenNamesOf(kind, variables, chosenName),
  };

  return (
    <div className="flex flex-col gap-2 border-b border-input bg-muted/40 p-2">
      {model.noVariables && (
        <p className="text-sm text-muted-foreground">
          {t("template-resolver.documentEditor.noVariables")}
        </p>
      )}
      {PANEL_FIELDS[kind](model)}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <PanelActions onCancel={onClose} {...panelActionProps(model)} />
      </div>
    </div>
  );
}
