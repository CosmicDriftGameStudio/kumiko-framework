import type { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./document-schema.ts";
import { parseDocumentStepsInput } from "./document-steps.ts";
import { type PanelKind, repeatTableContent } from "./document-tiptap-helpers.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;
type Primitives = ReturnType<typeof usePrimitives>;

export type PanelModel = {
  readonly t: Translate;
  readonly Button: Primitives["Button"];
  readonly Field: Primitives["Field"];
  readonly Input: Primitives["Input"];
  readonly editor: Editor;
  readonly kind: PanelKind;
  readonly idPrefix: string;
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly onClose: () => void;
  readonly href: string;
  readonly setHref: (value: string) => void;
  readonly resource: string;
  readonly setResource: (value: string) => void;
  readonly alt: string;
  readonly setAlt: (value: string) => void;
  readonly buttonText: string;
  readonly setButtonText: (value: string) => void;
  readonly stepsText: string;
  readonly setStepsText: (value: string) => void;
  readonly setChosenName: (value: string) => void;
  readonly setError: (value: string | null) => void;
  readonly selectable: readonly string[];
  readonly selectedName: string;
  readonly noVariables: boolean;
};

type ChosenNames = {
  readonly selectable: readonly string[];
  readonly selectedName: string;
  readonly noVariables: boolean;
};

export function chosenNamesOf(
  kind: PanelKind,
  variables: readonly string[],
  chosenName: string,
): ChosenNames {
  const referenceNames = variables.filter(isDocumentReferenceName);
  const buttonTargets = referenceNames.filter((name) => isDocumentPlaceholderHref(`{{${name}}}`));
  const selectable = kind === "button" ? buttonTargets : referenceNames;
  const selectedName = selectable.includes(chosenName) ? chosenName : (selectable[0] ?? "");
  const needsVariables =
    kind === "button" ||
    kind === "repeat" ||
    kind === "placeholder" ||
    kind === "steps" ||
    kind === "images";
  return { selectable, selectedName, noVariables: needsVariables && selectable.length === 0 };
}

export function insertAndCloseOf(m: PanelModel): (content: JSONContent) => void {
  return (content) => {
    m.editor.chain().focus().insertContent(content).run();
    m.onClose();
  };
}

function submitLinkOf(m: PanelModel): () => void {
  const { editor, href, t } = m;
  return () => {
    if (!isAllowedDocumentLinkHref(href)) {
      m.setError(t("template-resolver.documentEditor.invalidLink"));
      // skip: invalid input is reported through the panel error
      return;
    }
    const chain = editor.chain().focus();
    if (!editor.state.selection.empty) chain.setLink({ href }).run();
    else if (editor.isActive("link")) chain.extendMarkRange("link").setLink({ href }).run();
    else if (isDocumentPlaceholderHref(href))
      // Placeholders are never inserted as {{name}} text; the link shows the variable's value.
      chain
        .insertContent({
          type: "variable",
          attrs: { name: href.slice(2, -2) },
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    else
      chain
        .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
        .run();
    m.onClose();
  };
}

function submitImageOf(m: PanelModel): () => void {
  const { resource, alt, t } = m;
  return () => {
    if (!isDocumentResourceKey(resource)) {
      m.setError(t("template-resolver.documentEditor.invalidResourceKey"));
      // skip: invalid input is reported through the panel error
      return;
    }
    if (/[<>]/.test(alt)) {
      m.setError(t("template-resolver.documentEditor.invalidImageAlt"));
      // skip: invalid input is reported through the panel error
      return;
    }
    insertAndCloseOf(m)({ type: "resource", attrs: { resource, alt: alt || null } });
  };
}

function submitStepsOf(m: PanelModel): () => void {
  return () => {
    const steps = parseDocumentStepsInput(m.stepsText);
    if (steps === null) {
      m.setError(m.t("template-resolver.documentEditor.invalidSteps"));
      // skip: invalid input is reported through the panel error
      return;
    }
    insertAndCloseOf(m)({ type: "steps", attrs: { variable: m.selectedName, steps } });
  };
}

// Variable-bound kinds offer no insert while there is nothing to bind to.
const INSERT_HANDLERS: Partial<Record<PanelKind, (m: PanelModel) => () => void>> = {
  link: submitLinkOf,
  image: submitImageOf,
  button: (m) => () =>
    insertAndCloseOf(m)({
      type: "button",
      attrs: { href: `{{${m.selectedName}}}` },
      content: m.buttonText ? [{ type: "text", text: m.buttonText }] : [],
    }),
  repeat: (m) => () => insertAndCloseOf(m)(repeatTableContent(m.selectedName)),
  steps: submitStepsOf,
  images: (m) => () => insertAndCloseOf(m)({ type: "images", attrs: { variable: m.selectedName } }),
};

const KINDS_WITHOUT_VARIABLE_GUARD: readonly PanelKind[] = ["link", "image"];

export function panelActionProps(m: PanelModel): {
  onInsert?: () => void;
  onRemoveLink?: () => void;
} {
  const { editor, kind } = m;
  const build = INSERT_HANDLERS[kind];
  const insertAllowed = KINDS_WITHOUT_VARIABLE_GUARD.includes(kind) || !m.noVariables;
  return {
    ...(build !== undefined && insertAllowed && { onInsert: build(m) }),
    ...(kind === "link" &&
      editor.isActive("link") && {
        onRemoveLink: () => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          m.onClose();
        },
      }),
  };
}
