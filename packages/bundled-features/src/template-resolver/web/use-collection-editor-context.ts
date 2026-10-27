import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  type ContentEditorComponent,
  useAppFeatures,
  useContentEditor,
} from "@cosmicdrift/kumiko-renderer";
import {
  type ContentCollectionSchema,
  canWriteContent,
  findCollection,
} from "./collection-lookup.ts";
import type { DocumentToolbarBlock } from "./document-blocks.ts";
import { documentBlocksForKind } from "./document-toolbar-blocks.ts";

export type CollectionEditorContext = {
  readonly collection: ContentCollectionSchema | undefined;
  readonly contentFormat: ContentCollectionSchema["contentFormat"];
  readonly ContentEditor: ContentEditorComponent;
  readonly documentBlocks: readonly DocumentToolbarBlock[];
  /** The collection's fixed variable names with the example value the preview substitutes. */
  readonly variableExamples: Readonly<Record<string, string>>;
  readonly variables: readonly string[];
  readonly canWrite: boolean;
};

// No collection (the hand-wired text-block tree) → plain editor, no variables.
export function useCollectionEditorContext(collectionId?: string): CollectionEditorContext {
  const features = useAppFeatures();
  const user = useShellUser();
  const collection = findCollection(features, collectionId);
  const contentFormat = collection?.contentFormat;
  const variableExamples = collection?.variableSchema ?? {};
  return {
    collection,
    contentFormat,
    ContentEditor: useContentEditor(contentFormat),
    documentBlocks: documentBlocksForKind(collection?.kind),
    variableExamples,
    variables: Object.keys(variableExamples),
    canWrite: canWriteContent(collection, user?.roles),
  };
}
