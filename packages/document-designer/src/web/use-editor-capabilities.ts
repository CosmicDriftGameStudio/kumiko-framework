// @runtime client
import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useQuery } from "@cosmicdrift/kumiko-renderer";

export type EditorCapabilities = {
  readonly fileUploads: boolean;
  readonly testMail: boolean;
};

// Until the answer arrives the actions stay visible: hiding them first would make them flicker in
// every app that has them.
export function useEditorCapabilities(): EditorCapabilities {
  const { data } = useQuery<EditorCapabilities>(TemplateResolverQueries.editorCapabilities, {});
  return { fileUploads: data?.fileUploads ?? true, testMail: data?.testMail ?? true };
}
