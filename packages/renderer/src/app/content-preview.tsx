// Read-only render of a content editor's format with the collection's
// example variableSchema values substituted in for `{{name}}` — reuses the
// same registered editor the collection edits with (readOnly), so "rich"
// renders formatted HTML and "plain"/"markdown" render as text through the
// exact same component, no separate render path per format.

import type { ContentEditorFormat } from "@cosmicdrift/kumiko-types/nav";
import { type ReactNode, useId } from "react";
import { escapeHtmlAttr } from "../headless/index.ts";
import { useContentEditor } from "./content-editors.tsx";

const VARIABLE_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

const noop = (): void => {};

/** A name with no example value (or not in the schema at all) stays as the
 *  literal `{{name}}` placeholder — there is nothing else to show for it. */
export function substituteVariables(
  content: string,
  variables: Readonly<Record<string, string>>,
): string {
  return content.replace(VARIABLE_PATTERN, (match, name: string) =>
    Object.hasOwn(variables, name) ? (variables[name] ?? match) : match,
  );
}

export type ContentPreviewProps = {
  readonly content: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly contentFormat?: ContentEditorFormat;
};

export function ContentPreview({
  content,
  variables,
  contentFormat,
}: ContentPreviewProps): ReactNode {
  const Editor = useContentEditor(contentFormat);
  const id = useId();
  // "rich" content is HTML (see ContentCollectionDefinition.contentFormat) —
  // an example value substituted in raw could break the markup (`<`) or
  // render as an unescaped entity (`&`). "plain"/"markdown" content is text,
  // no escaping wanted there.
  const safeVariables =
    contentFormat === "rich"
      ? Object.fromEntries(
          Object.entries(variables).map(([name, value]) => [name, escapeHtmlAttr(value)]),
        )
      : variables;
  // "document" keeps `{{x}}` as-is: substituting it into a button/link href would make the
  // schema drop that node; variable chips stay visible.
  const value =
    contentFormat === "document" ? content : substituteVariables(content, safeVariables);
  return <Editor id={id} value={value} onChange={noop} variables={[]} readOnly />;
}
