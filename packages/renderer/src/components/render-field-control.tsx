import type { ReactNode } from "react";
import { type EditFieldViewModel, type FieldIssue, telHref } from "../headless/index.ts";
import type { usePrimitives } from "../primitives.tsx";
import { AvailabilityOptionsSelect } from "./availability-options-select.tsx";
import { DocumentFieldEditor } from "./document-field-editor.tsx";
import { EmbeddedListField } from "./embedded-list-field.tsx";
import { QueryOptionsSelect } from "./query-options-select.tsx";
import { AiAssistControl } from "./render-field-ai-assist.tsx";
import { FillActionControl } from "./render-field-fill-action.tsx";
import { renderInput } from "./render-field-input.tsx";
import type { RenderInputArgs } from "./render-field-input-shared.ts";
import { isComplexFieldType, isFileFieldType } from "./render-field-meta.ts";
import { FieldRendererOutput, readOnlyDisplayText } from "./render-field-read-only.tsx";
import { ReadOnlyReferenceValue, ReferenceInput } from "./render-field-reference.tsx";
import { ValueChipsControl } from "./render-field-value-chips.tsx";
import { stringValue } from "./render-field-values.ts";
import { WriteOnlyTextInput } from "./render-field-write-only.tsx";

export type ControlContext = RenderInputArgs & {
  readonly Link: ReturnType<typeof usePrimitives>["Link"];
  readonly readOnlyText: boolean;
  readonly featureName: string | undefined;
  readonly allIssues: Readonly<Record<string, readonly FieldIssue[]>> | undefined;
  readonly changed: boolean | undefined;
  readonly fillDisabled: boolean | undefined;
  readonly onSuggest?: (value: string) => void;
};

// A rule returns undefined to pass; the first rule that returns a control wins.
type ControlRule = (ctx: ControlContext) => ReactNode;

function rowOf({ field, row }: ControlContext): Readonly<Record<string, unknown>> {
  return row ?? { [field.field]: field.value };
}

// The list input prints its own list-level issues (including the empty state),
// so the Field wrapper must not print them a second time.
export function listPrintsOwnIssues(field: EditFieldViewModel): boolean {
  return (
    field.type === "embedded" &&
    field.embeddedListCells !== undefined &&
    !(field.readOnly && field.renderer !== undefined)
  );
}

// An author-declared renderer always wins over the input widget, same as
// the list-column path (render-list.tsx).
const fieldRendererRule: ControlRule = ({ field, appLocale, row }) => {
  if (!field.readOnly || field.renderer === undefined) return undefined;
  return (
    <FieldRendererOutput
      field={field}
      renderer={field.renderer}
      appLocale={appLocale}
      {...(row !== undefined && { row })}
    />
  );
};

const embeddedListRule: ControlRule = ({ field, id, onChange, allIssues, featureName }) => {
  if (field.type !== "embedded" || field.embeddedListCells === undefined) return undefined;
  return (
    <EmbeddedListField
      field={field}
      id={id}
      onChange={onChange}
      allIssues={allIssues ?? {}}
      featureName={featureName ?? ""}
    />
  );
};

// The reference field renders its own component because it uses useQuery()
// for the live lookup and must therefore be mounted as a React component,
// not called as a pure render function.
const referenceRule: ControlRule = ({
  field,
  id,
  hasError,
  onChange,
  Input,
  featureName,
  readOnlyText,
}) => {
  if (field.type !== "reference") return undefined;
  if (readOnlyText) {
    return <ReadOnlyReferenceValue field={field} featureName={featureName ?? ""} />;
  }
  return (
    <ReferenceInput
      field={field}
      id={id}
      hasError={hasError}
      onChange={onChange}
      Input={Input}
      featureName={featureName ?? ""}
    />
  );
};

const selectQueryRule: ControlRule = (ctx) => {
  const { field, id, hasError, onChange, onSuggest, readOnlyText } = ctx;
  const source = field.selectOptionsQuery;
  if (field.type !== "select" || source === undefined || readOnlyText) return undefined;
  return (
    <QueryOptionsSelect
      field={field}
      query={source.query}
      payload={source.payload}
      row={rowOf(ctx)}
      id={id}
      hasError={hasError}
      onChange={onChange}
      {...(onSuggest !== undefined && { onSuggest })}
    />
  );
};

const selectAvailabilityRule: ControlRule = (ctx) => {
  const { field, id, hasError, onChange, readOnlyText } = ctx;
  const source = field.selectOptionsAvailabilityQuery;
  if (field.type !== "select" || source === undefined || readOnlyText) return undefined;
  return (
    <AvailabilityOptionsSelect
      field={field}
      query={source.query}
      payload={source.payload}
      row={rowOf(ctx)}
      id={id}
      hasError={hasError}
      onChange={onChange}
    />
  );
};

function contactHref(field: EditFieldViewModel): string | undefined {
  if (field.type !== "text" || typeof field.value !== "string" || field.value.trim() === "") {
    return undefined;
  }
  if (field.format === "email") return `mailto:${field.value.trim()}`;
  if (field.format === "phone") {
    return telHref(field.value);
  }
  return undefined;
}

const readOnlyTextRule: ControlRule = ({ field, Text, Link, appLocale, t, readOnlyText }) => {
  if (!readOnlyText || isComplexFieldType(field.type) || isFileFieldType(field.type)) {
    return undefined;
  }
  const href = contactHref(field);
  if (href !== undefined) {
    return (
      <Link href={href} className="underline" testId={`field-value-${field.field}`}>
        {readOnlyDisplayText(field, appLocale, t)}
      </Link>
    );
  }
  return (
    <Text
      testId={`field-value-${field.field}`}
      {...(field.concealed === true && { concealed: true })}
    >
      {readOnlyDisplayText(field, appLocale, t)}
    </Text>
  );
};

const writeOnlyRule: ControlRule = ({ field, id, hasError, onChange, changed, readOnlyText }) => {
  if (field.type !== "text" || field.writeOnly !== true || readOnlyText) return undefined;
  return (
    <WriteOnlyTextInput
      field={field}
      id={id}
      hasError={hasError}
      onChange={onChange}
      changed={changed === true}
    />
  );
};

const fillActionRule: ControlRule = (ctx) => {
  const { field, onChange, fillDisabled, Banner } = ctx;
  const fillAction = field.fillAction;
  if (fillAction === undefined) return undefined;
  return (
    <FillActionControl
      field={field}
      fillAction={fillAction}
      row={rowOf(ctx)}
      onChange={onChange}
      disabled={fillDisabled === true}
      Banner={Banner}
      renderControl={(fill) => renderInput({ ...ctx, fill })}
    />
  );
};

// Without a registered "document" editor useContentEditor falls back to a textarea.
function documentEditorInput({ field, id, onChange }: ControlContext): ReactNode {
  if (field.editor !== "document" || field.type !== "longText") return undefined;
  return (
    <DocumentFieldEditor
      id={id}
      value={stringValue(field.value)}
      readOnly={field.readOnly}
      onChange={onChange}
    />
  );
}

const documentEditorRule: ControlRule = (ctx) => {
  // skip: the assist rule wraps this same editor
  if (ctx.field.aiAssist !== undefined && !ctx.field.readOnly) return undefined;
  return documentEditorInput(ctx);
};

const aiAssistRule: ControlRule = (ctx) => {
  const { field, onChange } = ctx;
  if (field.aiAssist === undefined || field.readOnly) return undefined;
  return (
    <AiAssistControl
      field={field}
      row={rowOf(ctx)}
      aiAssist={field.aiAssist}
      onChange={onChange}
      input={documentEditorInput(ctx) ?? renderInput(ctx)}
    />
  );
};

const valueChipsRule: ControlRule = (ctx) => {
  const { field, onChange } = ctx;
  if (field.valueChips === undefined || field.readOnly) return undefined;
  return (
    <ValueChipsControl
      field={field}
      from={field.valueChips.from}
      row={rowOf(ctx)}
      onChange={onChange}
      input={renderInput(ctx)}
    />
  );
};

const CONTROL_RULES: readonly ControlRule[] = [
  fieldRendererRule,
  embeddedListRule,
  referenceRule,
  selectQueryRule,
  selectAvailabilityRule,
  readOnlyTextRule,
  writeOnlyRule,
  documentEditorRule,
  fillActionRule,
  aiAssistRule,
  valueChipsRule,
];

export function renderControl(ctx: ControlContext): ReactNode {
  for (const rule of CONTROL_RULES) {
    const control = rule(ctx);
    if (control !== undefined) return control;
  }
  return renderInput(ctx);
}
