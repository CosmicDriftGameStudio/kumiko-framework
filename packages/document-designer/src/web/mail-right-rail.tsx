// @runtime client
import {
  MAIL_TONES,
  type MailTone,
  PlaceholderLineEditor,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  useAppFeatures,
  useNav,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ReactNode } from "react";
import { DEFAULT_LAYOUT_SLUG, TENANT_MAIL_SENDING_SCREEN_ID } from "../constants.js";
import type { EditorVocabulary } from "./mail-edit-center.js";
import type { LinkedResourceView, MailCategory, MailDraft } from "./mail-types.js";
import type { OverviewRowView } from "./overview-row.js";
import { RailField, RailHint, RailRow, RailSection } from "./rail.js";
import type { InsertTargets } from "./use-insert-targets.js";
import { usageParts } from "./used-by-label.js";

type Usage = {
  readonly feature: string;
  readonly notification: string;
  readonly tenantTransport?: boolean;
};

function useTemplateUsage(slug: string): readonly Usage[] {
  const { data } = useQuery<{ readonly usedBy: readonly Usage[] }>(TemplateResolverQueries.usage, {
    slug,
    kind: "mail",
  });
  return data?.usedBy ?? [];
}

function useHasScreen(screenId: string): boolean {
  const features = useAppFeatures();
  return features.some((feature) => feature.screens.some((screen) => screen.id === screenId));
}

// A notification routed through the tenant transport sends from the tenant's own provider, so
// the hint points there instead of to the platform.
function SenderHint({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslation();
  const nav = useNav();
  const { Link } = usePrimitives();
  const tenantRouted = useTemplateUsage(slug).some((usage) => usage.tenantTransport === true);
  const hasSettingsScreen = useHasScreen(TENANT_MAIL_SENDING_SCREEN_ID);
  if (!tenantRouted) return <RailHint>{t("documentDesigner.mail.props.senderHint")}</RailHint>;
  return (
    <RailHint>
      {t("documentDesigner.mail.props.senderHintTenant")}
      {hasSettingsScreen && (
        <>
          {" "}
          <Link
            href={nav.hrefFor({ screenId: TENANT_MAIL_SENDING_SCREEN_ID })}
            onPress={() => nav.navigate({ screenId: TENANT_MAIL_SENDING_SCREEN_ID })}
            testId="mail-sender-settings-link"
          >
            {t("documentDesigner.mail.props.senderSettingsLink")}
          </Link>
        </>
      )}
    </RailHint>
  );
}

export function layoutOptionLabel(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  layout: OverviewRowView,
): string {
  // A layout has no registry title; the slug would read like an id, so name it by kind.
  const title =
    layout.title === layout.slug
      ? t(`documentDesigner.editor.title.${layout.kind === "mail-layout" ? "mail" : "pdf"}`)
      : layout.title;
  return t(
    layout.origin === "tenant"
      ? "documentDesigner.mail.props.layoutTenant"
      : "documentDesigner.mail.props.layoutSystem",
    { title, version: layout.version },
  );
}

// Without a stored default layout the renderer uses its built-in one, so the
// select still needs an option for the value it shows.
function layoutOptions(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  layouts: readonly OverviewRowView[],
): readonly { readonly value: string; readonly label: string }[] {
  const stored = layouts.map((layout) => ({
    value: layout.slug,
    label: layoutOptionLabel(t, layout),
  }));
  return layouts.some((layout) => layout.slug === DEFAULT_LAYOUT_SLUG)
    ? stored
    : [
        { value: DEFAULT_LAYOUT_SLUG, label: t("documentDesigner.mail.props.layoutBuiltIn") },
        ...stored,
      ];
}

function UsageRows({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslation();
  const usedBy = useTemplateUsage(slug);
  return (
    <>
      {usedBy.map((usage) => {
        const parts = usageParts(t, usage);
        return (
          <RailRow
            key={`${usage.feature}:${usage.notification}`}
            label={t("documentDesigner.mail.usage.line", parts)}
            testId="mail-usage-row"
          />
        );
      })}
    </>
  );
}

export function AttachmentSection({
  attachments,
  pdfTitles,
  canEdit,
  onAddPdf,
  onRemove,
}: {
  readonly attachments: readonly LinkedResourceView[];
  readonly pdfTitles: ReadonlyMap<string, string>;
  readonly canEdit: boolean;
  readonly onAddPdf: () => void;
  readonly onRemove: (key: string) => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <RailSection
      title={t("documentDesigner.mail.attachments.title")}
      testId="mail-editor-attachments"
      action={
        <Button
          variant="link"
          disabled={!canEdit}
          onClick={onAddPdf}
          testId="mail-attachment-pdf-open"
        >
          {t("documentDesigner.mail.attachments.addPdf")}
        </Button>
      }
    >
      {attachments.length === 0 && <RailRow label={t("documentDesigner.mail.attachments.none")} />}
      {attachments.map((attachment) => (
        <RailRow
          key={attachment.key}
          testId="mail-attachment-row"
          symbol="⎘"
          label={
            attachment.kind === "pdf"
              ? t("documentDesigner.mail.attachments.pdfRow", {
                  title: pdfTitles.get(attachment.templateSlug) ?? attachment.templateSlug,
                })
              : attachment.kind === "file"
                ? attachment.fileName
                : attachment.key
          }
          trailing={
            attachment.kind === "pdf"
              ? attachment.fileName
              : t("documentDesigner.mail.attachments.file")
          }
          action={
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => onRemove(attachment.key)}
              testId={`mail-attachment-remove-${attachment.key}`}
            >
              {t("documentDesigner.mail.resource.remove")}
            </Button>
          }
        />
      ))}
      <RailHint>{t("documentDesigner.mail.attachments.hint")}</RailHint>
    </RailSection>
  );
}

export function PropertiesSection({
  slug,
  draft,
  layouts,
  onChange,
}: {
  readonly slug: string;
  readonly draft: MailDraft;
  readonly layouts: readonly OverviewRowView[];
  readonly onChange: (patch: Partial<MailDraft>) => void;
}): ReactNode {
  const t = useTranslation();
  const { Field, Input } = usePrimitives();
  const layoutValue = draft.layoutSlug === "" ? DEFAULT_LAYOUT_SLUG : draft.layoutSlug;
  const categoryValue: MailCategory = draft.category === "" ? "transactional" : draft.category;
  return (
    <RailSection title={t("documentDesigner.mail.props.title")} testId="mail-editor-properties">
      <RailField>
        <Field id="mail-layout" label={t("documentDesigner.mail.props.layout")}>
          <Input
            kind="select"
            id="mail-layout"
            name="mail-layout"
            value={layoutValue}
            display="dropdown"
            onChange={(next) => onChange({ layoutSlug: next })}
            options={layoutOptions(t, layouts)}
          />
        </Field>
      </RailField>
      <RailField>
        <Field id="mail-sender" label={t("documentDesigner.mail.props.sender")}>
          <Input
            kind="text"
            id="mail-sender"
            name="mail-sender"
            testId="mail-sender"
            value={draft.senderName}
            onChange={(next) => onChange({ senderName: next })}
            placeholder={t("documentDesigner.mail.props.senderPlaceholder")}
          />
        </Field>
      </RailField>
      <SenderHint slug={slug} />
      <RailField>
        <Field id="mail-reply-to" label={t("documentDesigner.mail.props.replyTo")}>
          <Input
            kind="email"
            id="mail-reply-to"
            name="mail-reply-to"
            testId="mail-reply-to"
            value={draft.replyTo}
            onChange={(next) => onChange({ replyTo: next })}
          />
        </Field>
      </RailField>
      <RailField>
        <Field id="mail-category" label={t("documentDesigner.mail.props.category")}>
          <Input
            kind="select"
            id="mail-category"
            name="mail-category"
            value={categoryValue}
            display="dropdown"
            onChange={(next) =>
              onChange({ category: next === "marketing" ? "marketing" : "transactional" })
            }
            options={[
              { value: "transactional", label: t("documentDesigner.mail.props.transactional") },
              { value: "marketing", label: t("documentDesigner.mail.props.marketing") },
            ]}
          />
        </Field>
      </RailField>
      <RailHint>{t("documentDesigner.mail.props.categoryHint")}</RailHint>
    </RailSection>
  );
}

const TONE_LABEL_KEYS: Readonly<Record<MailTone, string>> = {
  accent: "documentDesigner.mail.chrome.toneAccent",
  info: "documentDesigner.mail.chrome.toneInfo",
  success: "documentDesigner.mail.chrome.toneSuccess",
  warning: "documentDesigner.mail.chrome.toneWarning",
  danger: "documentDesigner.mail.chrome.toneDanger",
  neutral: "documentDesigner.mail.chrome.toneNeutral",
};

// The stored tone may be a placeholder that resolves per mail; the select keeps it as its own
// option so opening the template never silently drops it.
function toneOptions(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  current: string,
): readonly { readonly value: string; readonly label: string }[] {
  const fixed = MAIL_TONES.map((tone) => ({ value: tone, label: t(TONE_LABEL_KEYS[tone]) }));
  return current === "" || isOneOf(MAIL_TONES, current)
    ? fixed
    : [
        ...fixed,
        {
          value: current,
          label: t("documentDesigner.mail.chrome.toneFromPlaceholder", { value: current }),
        },
      ];
}

export function ChromeSection({
  draft,
  vocabulary,
  insert,
  onChange,
}: {
  readonly draft: MailDraft;
  readonly vocabulary: EditorVocabulary;
  readonly insert: InsertTargets;
  readonly onChange: (patch: Partial<MailDraft>) => void;
}): ReactNode {
  const t = useTranslation();
  const { Field, Input } = usePrimitives();
  // "accent" is the renderer default, so it is stored as an empty value.
  const toneValue = draft.tone === "" ? "accent" : draft.tone;
  return (
    <RailSection title={t("documentDesigner.mail.chrome.title")} testId="mail-editor-chrome">
      <RailField>
        <Field id="mail-header-chip" label={t("documentDesigner.mail.chrome.headerChip")}>
          <div onFocusCapture={insert.markFocused("headerChip")} data-testid="mail-header-chip">
            <PlaceholderLineEditor
              id="mail-header-chip"
              value={draft.headerChip}
              onChange={(headerChip) => onChange({ headerChip })}
              variableLabels={vocabulary.labels}
              systemVariables={vocabulary.system}
              placeholder={t("documentDesigner.mail.chrome.headerChipPlaceholder")}
              onEditorReady={insert.register("headerChip")}
              aria-label={t("documentDesigner.mail.chrome.headerChip")}
            />
          </div>
        </Field>
      </RailField>
      <RailField>
        <Field id="mail-tone" label={t("documentDesigner.mail.chrome.tone")}>
          <Input
            kind="select"
            id="mail-tone"
            name="mail-tone"
            value={toneValue}
            display="dropdown"
            onChange={(next) => onChange({ tone: next === "accent" ? "" : next })}
            options={toneOptions(t, draft.tone)}
          />
        </Field>
      </RailField>
      <RailField>
        <Field id="mail-footer-note" label={t("documentDesigner.mail.chrome.footerNote")}>
          <div onFocusCapture={insert.markFocused("footerNote")} data-testid="mail-footer-note">
            <PlaceholderLineEditor
              id="mail-footer-note"
              value={draft.footerNote}
              onChange={(footerNote) => onChange({ footerNote })}
              variableLabels={vocabulary.labels}
              systemVariables={vocabulary.system}
              placeholder={t("documentDesigner.mail.chrome.footerNotePlaceholder")}
              onEditorReady={insert.register("footerNote")}
              aria-label={t("documentDesigner.mail.chrome.footerNote")}
            />
          </div>
        </Field>
      </RailField>
      <RailHint>{t("documentDesigner.mail.chrome.hint")}</RailHint>
    </RailSection>
  );
}

export function UsageSection({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslation();
  return (
    <RailSection title={t("documentDesigner.mail.usage.title")} testId="mail-editor-usage">
      <UsageRows slug={slug} />
      <RailHint>{t("documentDesigner.mail.usage.hint")}</RailHint>
    </RailSection>
  );
}
