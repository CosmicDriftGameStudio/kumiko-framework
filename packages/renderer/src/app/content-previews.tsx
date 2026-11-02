// Preview registry: client-side lookup by preview target ("pdf" | "mail" | "web" | "text")
// for the preview mode of the editor workbench. Same registry shape as content-editors.tsx:
// String key in the declaration, component in the client bundle, last-wins merge in
// createKumikoApp. No entry for a target -> the "text" renderer, so a missing renderer is
// never an empty pane.

import type { ContentEditorFormat } from "@cosmicdrift/kumiko-types/nav";
import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import { ContentPreview } from "./content-preview.tsx";

export const PREVIEW_TARGETS = ["pdf", "mail", "web", "text"] as const;
export type PreviewTarget = (typeof PREVIEW_TARGETS)[number];

export type PreviewSubject =
  | {
      readonly kind: "template";
      readonly templateKind: string;
      readonly slug: string;
      readonly locale: string;
      readonly meta: unknown;
      /** Placeholder schema of the template; the server derives sample values from it. */
      readonly variableSchema?: unknown;
    }
  | { readonly kind: "layout"; readonly templateKind: string; readonly html: string }
  | { readonly kind: "body" };

export type PreviewRendererProps = {
  readonly content: string;
  readonly editFormat: ContentEditorFormat;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly subject: PreviewSubject;
  /** The renderer hands the answer of its server call to a host that shows it elsewhere (the mail editor's side rail). */
  readonly onResult?: (result: unknown) => void;
};

export type PreviewRenderer = ComponentType<PreviewRendererProps>;

export type ContentPreviewsMap = Partial<Record<PreviewTarget, PreviewRenderer>>;

const ContentPreviewsContext = createContext<ContentPreviewsMap>({});

export function ContentPreviewsProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: ContentPreviewsMap;
}): ReactNode {
  return (
    <ContentPreviewsContext.Provider value={value}>{children}</ContentPreviewsContext.Provider>
  );
}

function stringVariables(
  variables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const strings: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === "string") strings[name] = value;
  }
  return strings;
}

export function TextPreviewRenderer({
  content,
  editFormat,
  variables,
}: PreviewRendererProps): ReactNode {
  return (
    <ContentPreview
      content={content}
      variables={stringVariables(variables)}
      contentFormat={editFormat}
    />
  );
}

export function useContentPreview(target: PreviewTarget): PreviewRenderer {
  const map = useContext(ContentPreviewsContext);
  return map[target] ?? TextPreviewRenderer;
}

/** Mounts the renderer registered for `target`. */
export function PreviewPane({
  target,
  ...props
}: PreviewRendererProps & { readonly target: PreviewTarget }): ReactNode {
  const Renderer = useContentPreview(target);
  return <Renderer {...props} />;
}
