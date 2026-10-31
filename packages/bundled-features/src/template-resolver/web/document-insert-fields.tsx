import { usePrimitives, VariableChips } from "@cosmicdrift/kumiko-renderer";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import type { ReactNode } from "react";
import { insertAndCloseOf, type PanelModel } from "./document-insert-model.ts";
import { DOCUMENT_TEXT_ALIGNMENTS, type DocumentTextAlignment } from "./document-schema.ts";
import { type PanelKind, variableLabelOf } from "./document-tiptap-helpers.ts";

const ALIGNMENT_ICONS: Record<DocumentTextAlignment, ReactNode> = {
  left: <AlignLeft size={16} />,
  center: <AlignCenter size={16} />,
  right: <AlignRight size={16} />,
  justify: <AlignJustify size={16} />,
};

const ALIGNMENT_LABEL_KEYS: Record<DocumentTextAlignment, string> = {
  left: "template-resolver.documentEditor.alignLeft",
  center: "template-resolver.documentEditor.alignCenter",
  right: "template-resolver.documentEditor.alignRight",
  justify: "template-resolver.documentEditor.alignJustify",
};

type OptionSelectProps = {
  readonly id: string;
  readonly label: string;
  readonly names: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly value: string;
  readonly onChange: (name: string) => void;
};

function NameSelect({ id, label, names, labels, value, onChange }: OptionSelectProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label}>
      <Input
        kind="select"
        id={id}
        name={id}
        value={value}
        onChange={onChange}
        display="dropdown"
        options={names.map((name) => ({ value: name, label: variableLabelOf(name, labels) }))}
      />
    </Field>
  );
}

function renderLinkFields(m: PanelModel): ReactNode {
  const { t, Field, Input } = m;
  return (
    <Field id={`${m.idPrefix}-href`} label={t("template-resolver.documentEditor.linkHref")}>
      <Input
        kind="text"
        id={`${m.idPrefix}-href`}
        name="href"
        value={m.href}
        onChange={m.setHref}
        placeholder={t("template-resolver.documentEditor.linkHrefPlaceholder")}
      />
    </Field>
  );
}

function renderPlaceholderFields(m: PanelModel): ReactNode {
  return (
    !m.noVariables && (
      <div className="flex flex-wrap gap-1">
        <VariableChips
          variables={m.selectable}
          labels={m.variableLabels}
          onInsert={(name) => insertAndCloseOf(m)({ type: "variable", attrs: { name } })}
        />
      </div>
    )
  );
}

function renderAlignFields(m: PanelModel): ReactNode {
  const { t, Button, editor } = m;
  return (
    <div className="flex flex-wrap gap-1">
      {DOCUMENT_TEXT_ALIGNMENTS.map((alignment) => (
        <Button
          key={alignment}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            editor
              .chain()
              .focus()
              .updateAttributes("paragraph", { textAlign: alignment })
              .updateAttributes("heading", { textAlign: alignment })
              .run();
            m.onClose();
          }}
        >
          {ALIGNMENT_ICONS[alignment]}
          {t(ALIGNMENT_LABEL_KEYS[alignment])}
        </Button>
      ))}
    </div>
  );
}

function renderImageFields(m: PanelModel): ReactNode {
  const { t, Field, Input, idPrefix } = m;
  return (
    <>
      <Field id={`${idPrefix}-resource`} label={t("template-resolver.documentEditor.resourceKey")}>
        <Input
          kind="text"
          id={`${idPrefix}-resource`}
          name="resource"
          value={m.resource}
          onChange={m.setResource}
        />
      </Field>
      <Field id={`${idPrefix}-alt`} label={t("template-resolver.documentEditor.imageAlt")}>
        <Input kind="text" id={`${idPrefix}-alt`} name="alt" value={m.alt} onChange={m.setAlt} />
      </Field>
    </>
  );
}

function renderVariableAndTextFields(
  m: PanelModel,
  fields: {
    readonly variableIdSuffix: string;
    readonly variableLabel: string;
    readonly textIdSuffix: string;
    readonly textLabel: string;
    readonly textName: string;
    readonly textValue: string;
    readonly onTextChange: (value: string) => void;
  },
): ReactNode {
  const { Field, Input, idPrefix } = m;
  return (
    !m.noVariables && (
      <>
        <NameSelect
          id={`${idPrefix}-${fields.variableIdSuffix}`}
          label={fields.variableLabel}
          names={m.selectable}
          labels={m.variableLabels}
          value={m.selectedName}
          onChange={m.setChosenName}
        />
        <Field id={`${idPrefix}-${fields.textIdSuffix}`} label={fields.textLabel}>
          <Input
            kind="text"
            id={`${idPrefix}-${fields.textIdSuffix}`}
            name={fields.textName}
            value={fields.textValue}
            onChange={fields.onTextChange}
          />
        </Field>
      </>
    )
  );
}

function renderButtonFields(m: PanelModel): ReactNode {
  return renderVariableAndTextFields(m, {
    variableIdSuffix: "target",
    variableLabel: m.t("template-resolver.documentEditor.buttonTarget"),
    textIdSuffix: "text",
    textLabel: m.t("template-resolver.documentEditor.buttonText"),
    textName: "text",
    textValue: m.buttonText,
    onTextChange: m.setButtonText,
  });
}

function renderRepeatFields(m: PanelModel): ReactNode {
  return (
    !m.noVariables && (
      <NameSelect
        id={`${m.idPrefix}-list`}
        label={m.t("template-resolver.documentEditor.repeatList")}
        names={m.selectable}
        labels={m.variableLabels}
        value={m.selectedName}
        onChange={m.setChosenName}
      />
    )
  );
}

function renderImagesFields(m: PanelModel): ReactNode {
  return (
    !m.noVariables && (
      <NameSelect
        id={`${m.idPrefix}-images-variable`}
        label={m.t("template-resolver.documentEditor.imagesVariable")}
        names={m.selectable}
        labels={m.variableLabels}
        value={m.selectedName}
        onChange={m.setChosenName}
      />
    )
  );
}

function renderStepsFields(m: PanelModel): ReactNode {
  return renderVariableAndTextFields(m, {
    variableIdSuffix: "steps-variable",
    variableLabel: m.t("template-resolver.documentEditor.stepsVariable"),
    textIdSuffix: "steps-list",
    textLabel: m.t("template-resolver.documentEditor.stepsList"),
    textName: "steps",
    textValue: m.stepsText,
    onTextChange: m.setStepsText,
  });
}

export const PANEL_FIELDS: Readonly<Record<PanelKind, (m: PanelModel) => ReactNode>> = {
  link: renderLinkFields,
  placeholder: renderPlaceholderFields,
  align: renderAlignFields,
  image: renderImageFields,
  button: renderButtonFields,
  repeat: renderRepeatFields,
  images: renderImagesFields,
  steps: renderStepsFields,
};
