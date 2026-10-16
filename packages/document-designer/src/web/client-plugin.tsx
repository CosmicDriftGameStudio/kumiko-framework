// @runtime client
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useNav } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { documentDesignerTranslations } from "./i18n.js";
import { PdfTemplateEditor } from "./pdf-template-editor.js";

/**
 * Custom screen body: the template comes from the URL (`?slug=...&locale=...`),
 * because custom screens receive no props.
 */
export function PdfTemplateEditorScreen(): ReactNode {
  const { searchParams, setSearchParams } = useNav();
  const slug = searchParams["slug"];
  if (slug === undefined || slug === "") return null;
  return (
    <PdfTemplateEditor
      slug={slug}
      {...(searchParams["locale"] !== undefined && { locale: searchParams["locale"] })}
      onLocaleChange={(locale) => setSearchParams({ locale })}
    />
  );
}

/** Registers the editor as custom screen `screenId` and ships its (and the editor's) translations. */
export function documentDesignerClient(screenId: string): ClientFeatureDefinition {
  return {
    name: "document-designer",
    translations: {
      en: { ...textBlocksClient().translations?.["en"], ...documentDesignerTranslations["en"] },
      de: { ...textBlocksClient().translations?.["de"], ...documentDesignerTranslations["de"] },
    },
    components: { [screenId]: PdfTemplateEditorScreen },
  };
}
