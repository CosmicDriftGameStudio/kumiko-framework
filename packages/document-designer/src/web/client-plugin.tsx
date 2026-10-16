// @runtime client
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  mergeTranslations,
  translationsByLocaleFromKeys,
  useNav,
} from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import {
  DEFAULT_TEMPLATE_LOCALES,
  DOCUMENT_DESIGNER_FEATURE,
  DocumentDesignerCells,
  LAYOUT_EDITOR_SCREEN_ID,
} from "../constants.js";
import { DOCUMENT_DESIGNER_I18N } from "../i18n.js";
import {
  createLocalesCell,
  KindCell,
  ModifiedCell,
  OriginCell,
  OverriddenByCell,
  SlugCell,
  StatusCell,
  UsedByCell,
} from "./cells.js";
import { documentDesignerTranslations } from "./i18n.js";
import { LayoutEditor } from "./layout-editor.js";
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

export type DocumentDesignerClientOptions = {
  /** Locales shown as boxes in the overview's languages column; templates in other locales are appended. */
  readonly appLocales?: readonly string[];
  /** Custom screen id the app declared for the PDF template editor; without it the editor is not registered. */
  readonly pdfEditorScreenId?: string;
};

export function documentDesignerClient(
  options: DocumentDesignerClientOptions = {},
): ClientFeatureDefinition {
  return {
    name: DOCUMENT_DESIGNER_FEATURE,
    columnRenderers: {
      [DocumentDesignerCells.slug]: SlugCell,
      [DocumentDesignerCells.kind]: KindCell,
      [DocumentDesignerCells.origin]: OriginCell,
      [DocumentDesignerCells.locales]: createLocalesCell(
        options.appLocales ?? DEFAULT_TEMPLATE_LOCALES,
      ),
      [DocumentDesignerCells.status]: StatusCell,
      [DocumentDesignerCells.usedBy]: UsedByCell,
      [DocumentDesignerCells.modifiedAt]: ModifiedCell,
      [DocumentDesignerCells.overriddenBy]: OverriddenByCell,
    },
    components: {
      [LAYOUT_EDITOR_SCREEN_ID]: LayoutEditor,
      ...(options.pdfEditorScreenId !== undefined && {
        [options.pdfEditorScreenId]: PdfTemplateEditorScreen,
      }),
    },
    translations: mergeTranslations(
      mergeTranslations(textBlocksClient().translations ?? {}, documentDesignerTranslations),
      translationsByLocaleFromKeys(DOCUMENT_DESIGNER_I18N),
    ),
  };
}
