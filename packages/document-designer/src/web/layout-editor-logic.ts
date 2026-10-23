import {
  MAIL_DOCUMENT_BLOCKS,
  PDF_DOCUMENT_BLOCKS,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { dispatcherErrorText, type useMutation } from "@cosmicdrift/kumiko-renderer";
import { pluralKey } from "@cosmicdrift/kumiko-renderer/headless";
import { composeLayoutHtml } from "./compose-layout.ts";
import type { FooterTone } from "./editor-shell.tsx";
import { fileUrl } from "./file-name.ts";
import { isHexColor, type LayoutAppearance, type LayoutWidth, metaToSave } from "./layout-meta.ts";
import type {
  BrandingView,
  LayoutKind,
  LayoutSourceView,
  LayoutValidation,
  UpsertResponse,
  ValidationIssue,
} from "./layout-types.ts";
import { asRowStatus } from "./status-label.ts";

export type EditorTab = "draft" | "mjml";
export type Region = "header" | "signature" | "footer";
export type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export const REGION_EDITOR_IDS: Readonly<Record<Region, string>> = {
  header: "document-designer-region-header",
  signature: "document-designer-region-signature",
  footer: "document-designer-region-footer",
};

export const PAPER_WIDTH_CLASS: Readonly<Record<LayoutWidth, string>> = {
  560: "max-w-[560px]",
  600: "max-w-[600px]",
  640: "max-w-[640px]",
};

export type FooterMessage = { readonly tone: FooterTone; readonly text: string } | null;

export type ResourcePreviews = Readonly<
  Record<string, { readonly src: string; readonly caption: string }>
>;

export function issueText(t: Translate, issue: ValidationIssue): string {
  const translated = t(issue.i18nKey, issue.params);
  return translated === issue.i18nKey ? issue.code : translated;
}

export function sameAppearance(a: LayoutAppearance, b: LayoutAppearance): boolean {
  return (
    a.width === b.width &&
    a.font === b.font &&
    a.outerBackground === b.outerBackground &&
    a.accentLine === b.accentLine &&
    a.buttonStyle === b.buttonStyle
  );
}

export function initialTab(showMjmlTab: boolean, source: LayoutSourceView): EditorTab {
  return showMjmlTab && source.effectiveFormat === "mjml" ? "mjml" : "draft";
}

export function layoutDirty(input: {
  readonly mjmlMode: boolean;
  readonly mjml: string;
  readonly header: string;
  readonly signature: string;
  readonly footer: string;
  readonly appearance: LayoutAppearance;
  readonly storedAppearance: LayoutAppearance;
  readonly appearanceEditable: boolean;
  readonly source: LayoutSourceView;
}): boolean {
  const { source } = input;
  const appearanceDirty =
    input.appearanceEditable && !sameAppearance(input.appearance, input.storedAppearance);
  const htmlDirty =
    input.header !== source.regions.header ||
    input.signature !== source.regions.signature ||
    input.footer !== source.regions.footer ||
    appearanceDirty;
  return input.mjmlMode ? input.mjml !== (source.mjmlSource ?? "") : htmlDirty;
}

export function layoutContent(input: {
  readonly mjmlMode: boolean;
  readonly mjml: string;
  readonly header: string;
  readonly signature: string;
  readonly footer: string;
  readonly isMail: boolean;
}): string {
  return input.mjmlMode
    ? input.mjml
    : composeLayoutHtml({
        header: input.header,
        signature: input.isMail ? input.signature : "",
        footer: input.footer,
      });
}

export function footerMessageOf(input: {
  readonly t: Translate;
  readonly checked: LayoutValidation | null;
  readonly appearanceValid: boolean;
  readonly isMail: boolean;
  readonly userCount: number;
}): FooterMessage {
  const { t, checked, userCount } = input;
  if (checked === null) return null; // skip: nothing validated yet, no footer message
  if (!input.appearanceValid) {
    return { tone: "bad", text: t("documentDesigner.appearance.backgroundInvalid") };
  }
  const blockingIssue = [...checked.issues, ...checked.publishIssues][0];
  if (blockingIssue !== undefined) return { tone: "bad", text: issueText(t, blockingIssue) };
  return {
    tone: "ok",
    text: t(
      pluralKey(
        input.isMail
          ? "documentDesigner.editor.footer.okMail"
          : "documentDesigner.editor.footer.okPdf",
        userCount,
      ),
      { count: userCount },
    ),
  };
}

// A layout region has no per-mail variables, so a steps block there could never show a stage and an images block no photos.
export function layoutBlocks(isMail: boolean) {
  return (isMail ? MAIL_DOCUMENT_BLOCKS : PDF_DOCUMENT_BLOCKS).filter(
    (block) => block !== "steps" && block !== "images",
  );
}

// The layout's "logo" resource is the branding logo, so the editor shows it instead of a chip.
export function resourcePreviewsOf(
  branding: BrandingView | null,
  isMail: boolean,
  t: Translate,
): ResourcePreviews | undefined {
  const logoFile = branding?.logoFile ?? "";
  if (logoFile === "") return undefined; // skip: no branding logo to preview
  return {
    logo: {
      src: fileUrl(logoFile),
      caption: isMail ? t("documentDesigner.editor.logoCaption") : "",
    },
  };
}

type UpsertMutation = ReturnType<typeof useMutation<UpsertResponse>>;
type PublishMutation = ReturnType<typeof useMutation>;

export type SaveLayoutInput = {
  readonly publish: boolean;
  readonly kind: LayoutKind;
  readonly slug: string;
  readonly source: LayoutSourceView;
  readonly content: string;
  readonly mjmlMode: boolean;
  readonly isMail: boolean;
  readonly isSystemAdmin: boolean;
  readonly appearanceEditable: boolean;
  readonly appearance: LayoutAppearance;
  readonly t: Translate;
  readonly upsertTenant: UpsertMutation;
  readonly upsertSystem: UpsertMutation;
  readonly publishSystem: PublishMutation;
  readonly setSaveError: (message: string | null) => void;
  readonly onReload: () => Promise<void>;
};

function metaOf(input: SaveLayoutInput) {
  if (input.appearanceEditable) return metaToSave(input.appearance, input.source.meta);
  return input.isMail ? input.source.meta : {};
}

export async function saveLayout(input: SaveLayoutInput): Promise<void> {
  const { t, setSaveError } = input;
  setSaveError(null);
  const base = {
    slug: input.slug,
    kind: input.kind,
    locale: input.source.locale,
    content: input.content,
    contentFormat: input.mjmlMode ? "mjml" : "html",
    meta: metaOf(input),
  };
  const saved = input.isSystemAdmin
    ? await input.upsertSystem.mutate(base)
    : await input.upsertTenant.mutate({ ...base, status: input.publish ? "active" : "draft" });
  if (!saved.isSuccess) {
    setSaveError(dispatcherErrorText(saved.error, t));
    // skip: the failure is shown through saveError
    return;
  }
  if (input.isSystemAdmin && input.publish) {
    const published = await input.publishSystem.mutate({ id: saved.data.id });
    if (!published.isSuccess) {
      setSaveError(dispatcherErrorText(published.error, t));
      // skip: the failure is shown through saveError
      return;
    }
  }
  await input.onReload();
}

export function accentLineShown(input: {
  readonly isMail: boolean;
  readonly appearanceEditable: boolean;
  readonly appearance: LayoutAppearance;
  readonly accentColor: string;
}): boolean {
  return (
    input.isMail &&
    input.appearanceEditable &&
    input.appearance.accentLine === "branding" &&
    isHexColor(input.accentColor)
  );
}

export function appearanceFlags(input: {
  readonly isMail: boolean;
  readonly mjmlMode: boolean;
  readonly source: LayoutSourceView;
  readonly appearance: LayoutAppearance;
}) {
  // An mjml layout brings its own look; the appearance fields only drive structured (html) layouts.
  const appearanceFromMjml = input.source.effectiveFormat === "mjml" || input.mjmlMode;
  const appearanceEditable = input.isMail && !appearanceFromMjml;
  const appearanceValid = !appearanceEditable || isHexColor(input.appearance.outerBackground);
  return { appearanceFromMjml, appearanceEditable, appearanceValid };
}

export function shownRowOf(isSystemAdmin: boolean, source: LayoutSourceView) {
  return isSystemAdmin ? source.system : (source.tenant ?? source.system);
}

export function layoutSaveFlags(input: {
  readonly dirty: boolean;
  readonly checked: LayoutValidation | null;
  readonly appearanceValid: boolean;
  readonly busy: boolean;
  readonly shownRow: ReturnType<typeof shownRowOf>;
}) {
  const { checked, appearanceValid, busy } = input;
  const shownStatus = input.shownRow === null ? null : asRowStatus(input.shownRow.status);
  return {
    canSave: input.dirty && checked?.canSave === true && appearanceValid && !busy,
    canPublish:
      checked?.canPublish === true &&
      appearanceValid &&
      (input.dirty || shownStatus === "draft") &&
      !busy,
  };
}
