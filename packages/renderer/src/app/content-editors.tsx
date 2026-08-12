// Content-Editor-Components-Map: client-side lookup by `contentFormat`
// ("plain" | "rich" | "markdown") for r.contentCollection() entries. A collection
// declares its contentFormat in the schema; the client resolves it to a
// React component here. Same registry shape as columnRenderers/
// extensionSectionComponents — String-key in the schema, Component in the
// client bundle, last-wins merge in createKumikoApp.
//
// No entry registered for a format → TextareaContentEditor, so a missing
// editor is never an empty panel.

import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import { usePrimitives } from "../primitives";

export type ContentEditorProps = {
  /** DOM id every registered editor must render onto its own focusable
   *  root element. Callers that wrap an editor in a `Field` (label +
   *  htmlFor) pass a stable id here so the label stays associated with
   *  whatever element actually renders — a fixed constant would break as
   *  soon as a registered editor swaps in for the textarea fallback. */
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Variable names insertable as chips (from the collection's
   *  variableSchema). Empty until the variable-chip step wires it up —
   *  editors must accept it now, that's the point of fixing the signature
   *  here. */
  readonly variables: readonly string[];
  readonly readOnly: boolean;
};

export type ContentEditorComponent = ComponentType<ContentEditorProps>;

/** Default id value for callers that don't generate their own (e.g. a
 *  standalone TextareaContentEditor render outside a multi-editor page).
 *  Registered editors don't apply this automatically — every caller passes
 *  its own id via ContentEditorProps.id. */
export const CONTENT_EDITOR_ELEMENT_ID = "content-editor-textarea";

export type ContentEditorsMap = Readonly<Record<string, ContentEditorComponent>>;

const ContentEditorsContext = createContext<ContentEditorsMap>({});

export type ContentEditorsProviderProps = {
  readonly children: ReactNode;
  readonly value: ContentEditorsMap;
};

export function ContentEditorsProvider({
  children,
  value,
}: ContentEditorsProviderProps): ReactNode {
  return <ContentEditorsContext.Provider value={value}>{children}</ContentEditorsContext.Provider>;
}

/** Plain-textarea fallback for a contentFormat with no registered editor.
 *  Uses the primitives Input like every other form field, so it renders on
 *  every platform without requiring the platform's DOM/native equivalent. */
export function TextareaContentEditor({
  id,
  value,
  onChange,
  readOnly,
}: ContentEditorProps): ReactNode {
  const { Input } = usePrimitives();
  return (
    <Input
      kind="textarea"
      id={id}
      name={CONTENT_EDITOR_ELEMENT_ID}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      rows={14}
    />
  );
}

/** Resolves the editor for a contentFormat, falling back to the plain
 *  textarea when no clientFeature registered one. `contentFormat`
 *  undefined (collection didn't declare one) behaves like "plain". */
export function useContentEditor(contentFormat?: string): ContentEditorComponent {
  const map = useContext(ContentEditorsContext);
  return map[contentFormat ?? "plain"] ?? TextareaContentEditor;
}
