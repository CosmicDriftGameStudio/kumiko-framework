import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  mergeTranslations,
  translationsByLocaleFromKeys,
  useNav,
} from "@cosmicdrift/kumiko-renderer";
import { type ClientFeatureDefinition, LoadingState } from "@cosmicdrift/kumiko-renderer/web";
import { lazy, type ReactNode, Suspense } from "react";
import {
  createLocalesCell,
  KindCell,
  ModifiedCell,
  OriginCell,
  OverriddenByCell,
  StatusCell,
  TitleCell,
  UsedByCell,
} from "./cells.tsx";
import {
  DEFAULT_TEMPLATE_LOCALES,
  DOCUMENT_DESIGNER_FEATURE,
  DocumentDesignerCells,
  LAYOUT_EDITOR_SCREEN_ID,
  MAIL_EDITOR_SCREEN_ID,
  PDF_TEMPLATE_EDITOR_SCREEN_ID,
  PLATFORM_LAYOUT_EDITOR_SCREEN_ID,
} from "./constants.ts";
import { documentDesignerTranslations } from "./default-translations.ts";
import { DOCUMENT_DESIGNER_I18N } from "./i18n.ts";

// The editors pull tiptap, MJML preview and the page canvas; load them on first mount.
const LazyLayoutEditor = lazy(() =>
  import("./layout-editor.tsx").then((module) => ({ default: module.LayoutEditor })),
);
const LazyPdfTemplateEditor = lazy(() =>
  import("./pdf-template-editor.tsx").then((module) => ({ default: module.PdfTemplateEditor })),
);

function LayoutEditorScreen(): ReactNode {
  return (
    <Suspense fallback={<LoadingState />}>
      <LazyLayoutEditor scope="tenant" />
    </Suspense>
  );
}

function PlatformLayoutEditorScreen(): ReactNode {
  return (
    <Suspense fallback={<LoadingState />}>
      <LazyLayoutEditor scope="system" />
    </Suspense>
  );
}

function createLazyMailEditor(appLocales: readonly string[]): () => ReactNode {
  const LazyMailEditor = lazy(() =>
    import("./mail-editor.tsx").then((module) => ({
      default: module.createMailEditor(appLocales),
    })),
  );
  return function MailEditorScreen(): ReactNode {
    return (
      <Suspense fallback={<LoadingState />}>
        <LazyMailEditor />
      </Suspense>
    );
  };
}

/**
 * Custom screen body: the template comes from the URL (`?slug=...&locale=...`),
 * because custom screens receive no props.
 */
export function PdfTemplateEditorScreen(): ReactNode {
  const { searchParams, setSearchParams } = useNav();
  const slug = searchParams["slug"];
  if (slug === undefined || slug === "") return null;
  return (
    <Suspense fallback={<LoadingState />}>
      <LazyPdfTemplateEditor
        slug={slug}
        {...(searchParams["locale"] !== undefined && { locale: searchParams["locale"] })}
        onLocaleChange={(locale) => setSearchParams({ locale })}
      />
    </Suspense>
  );
}

export type DocumentDesignerClientOptions = {
  /** Locales shown as boxes in the overview's languages column; templates in other locales are appended. */
  readonly appLocales?: readonly string[];
};

export function documentDesignerClient(
  options: DocumentDesignerClientOptions = {},
): ClientFeatureDefinition {
  return {
    name: DOCUMENT_DESIGNER_FEATURE,
    columnRenderers: {
      [DocumentDesignerCells.title]: TitleCell,
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
      [LAYOUT_EDITOR_SCREEN_ID]: LayoutEditorScreen,
      [PLATFORM_LAYOUT_EDITOR_SCREEN_ID]: PlatformLayoutEditorScreen,
      [PDF_TEMPLATE_EDITOR_SCREEN_ID]: PdfTemplateEditorScreen,
      [MAIL_EDITOR_SCREEN_ID]: createLazyMailEditor(options.appLocales ?? DEFAULT_TEMPLATE_LOCALES),
    },
    translations: mergeTranslations(
      mergeTranslations(textBlocksClient().translations ?? {}, documentDesignerTranslations),
      translationsByLocaleFromKeys(DOCUMENT_DESIGNER_I18N),
    ),
  };
}
