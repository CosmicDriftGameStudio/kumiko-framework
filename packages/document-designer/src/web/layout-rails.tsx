import {
  useAppFeatures,
  useNav,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { BRANDING_SCREEN_QN } from "./constants.ts";
import {
  isHexColor,
  LAYOUT_ACCENT_LINES,
  LAYOUT_BUTTON_STYLES,
  LAYOUT_FONTS,
  LAYOUT_WIDTHS,
  type LayoutAppearance,
} from "./layout-meta.ts";
import type { BrandingView, LayoutKind, LayoutValidation } from "./layout-types.ts";
import { layoutUsers } from "./layout-users.ts";
import {
  PLACEHOLDER_SYMBOL,
  SYSTEM_PLACEHOLDER_TYPE,
  systemPlaceholderLabel,
} from "./mail-draft.ts";
import type { OverviewRowView } from "./overview-row.ts";
import { RailField, RailHint, RailRow, RailSection } from "./rail.tsx";
import { statusLabel } from "./status-label.ts";
import { templateTitleText } from "./used-by-label.ts";

const BRANDING_SCREEN_SHORT_ID = BRANDING_SCREEN_QN.slice(BRANDING_SCREEN_QN.lastIndexOf(":") + 1);

function logoName(logoUrl: string): string {
  const path = logoUrl.split("?")[0] ?? "";
  return path.slice(path.lastIndexOf("/") + 1);
}

function hostOf(siteUrl: string): string {
  return siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// The color is user data, so it goes into a style attribute instead of a class.
function ColorSwatch({ color }: { readonly color: string }): ReactNode {
  return (
    <span
      data-testid="document-designer-accent-swatch"
      className="inline-block size-3.5 shrink-0 rounded-sm border"
      style={{ backgroundColor: color }}
    />
  );
}

export function BrandingRail({
  data,
  unavailable,
}: {
  readonly data: BrandingView | null;
  readonly unavailable: boolean;
}): ReactNode {
  const t = useTranslation();
  const nav = useNav();
  const features = useAppFeatures();
  const { Link } = usePrimitives();
  const hasBrandingScreen = features.some(
    (feature) =>
      feature.featureName === "managed-pages" &&
      feature.screens.some((screen) => screen.id === BRANDING_SCREEN_SHORT_ID),
  );
  const notSet = t("documentDesigner.branding.notSet");
  const value = (text: string | undefined): string =>
    text === undefined || text === "" ? notSet : text;

  const editLink = hasBrandingScreen ? (
    <Link
      href={nav.hrefFor({ screenId: BRANDING_SCREEN_SHORT_ID })}
      onPress={() => nav.navigate({ screenId: BRANDING_SCREEN_SHORT_ID })}
      testId="document-designer-branding-edit"
    >
      {t("documentDesigner.branding.edit")}
    </Link>
  ) : undefined;

  if (unavailable) {
    return (
      <RailSection title={t("documentDesigner.branding.title")} testId="document-designer-branding">
        <RailHint>{t("documentDesigner.branding.unavailable")}</RailHint>
      </RailSection>
    );
  }
  const accent = data?.accentColor ?? "";
  const logo =
    data?.logoUrl !== undefined && data.logoUrl !== ""
      ? logoName(data.logoUrl)
      : data?.logoFile !== undefined && data.logoFile !== ""
        ? t("documentDesigner.branding.logoUploaded")
        : notSet;
  return (
    <RailSection
      title={t("documentDesigner.branding.title")}
      action={editLink}
      testId="document-designer-branding"
    >
      <RailRow label={t("documentDesigner.branding.productName")} trailing={value(data?.title)} />
      <RailRow
        label={t("documentDesigner.branding.accentColor")}
        trailing={
          isHexColor(accent) ? (
            <span className="inline-flex items-center gap-1.5">
              <ColorSwatch color={accent} />
              <code>{accent}</code>
            </span>
          ) : (
            value(accent)
          )
        }
      />
      <RailRow label={t("documentDesigner.branding.logo")} trailing={logo} />
      <RailRow
        label={t("documentDesigner.branding.website")}
        trailing={
          data?.siteUrl === undefined || data.siteUrl === "" ? notSet : hostOf(data.siteUrl)
        }
      />
      <RailHint>{t("documentDesigner.branding.hint")}</RailHint>
    </RailSection>
  );
}

export function PlaceholderRail({
  validation,
}: {
  readonly validation: LayoutValidation | null;
}): ReactNode {
  const t = useTranslation();
  const used = new Set(validation?.used ?? []);
  return (
    <RailSection
      title={t("documentDesigner.layoutPlaceholders.title")}
      testId="document-designer-placeholders"
    >
      <RailRow
        symbol="⊞"
        label={t("documentDesigner.placeholders.content")}
        required
        trailing="✓"
        trailingTone="ok"
      />
      {(validation?.systemPlaceholders ?? []).map((name) => (
        <RailRow
          key={name}
          testId={`document-designer-placeholder-${name}`}
          symbol={PLACEHOLDER_SYMBOL[SYSTEM_PLACEHOLDER_TYPE[name] ?? "text"]}
          label={systemPlaceholderLabel(t, name)}
          trailing={used.has(name) ? "✓" : "–"}
          trailingTone={used.has(name) ? "ok" : "muted"}
        />
      ))}
    </RailSection>
  );
}

// Both renderers always run for their kind; the rows say which one produces the output.
export function RendererRail({ kind }: { readonly kind: LayoutKind }): ReactNode {
  const t = useTranslation();
  return (
    <RailSection title={t("documentDesigner.renderer.title")} testId="document-designer-renderer">
      <RailRow
        label={t(
          kind === "mail-layout"
            ? "documentDesigner.renderer.mjml"
            : "documentDesigner.renderer.chromium",
        )}
        trailing={t("documentDesigner.renderer.active")}
        trailingTone="ok"
      />
    </RailSection>
  );
}

export function AppearanceRail({
  appearance,
  onChange,
  fromMjml,
}: {
  readonly appearance: LayoutAppearance;
  readonly onChange: (next: LayoutAppearance) => void;
  /** An mjml layout brings its own look, so the controls would have no effect. */
  readonly fromMjml: boolean;
}): ReactNode {
  const t = useTranslation();
  const { Field, Input } = usePrimitives();
  const patch = (changes: Partial<LayoutAppearance>): void =>
    onChange({ ...appearance, ...changes });
  const backgroundInvalid = !isHexColor(appearance.outerBackground);
  return (
    <RailSection
      title={t("documentDesigner.appearance.title")}
      testId="document-designer-appearance"
    >
      {fromMjml ? (
        <RailHint>{t("documentDesigner.appearance.fromMjml")}</RailHint>
      ) : (
        <RailField>
          <Field id="dd-layout-width" label={t("documentDesigner.appearance.width")}>
            <Input
              kind="select"
              id="dd-layout-width"
              name="width"
              value={String(appearance.width)}
              onChange={(value) => {
                const width = LAYOUT_WIDTHS.find((candidate) => String(candidate) === value);
                if (width !== undefined) patch({ width });
              }}
              display="dropdown"
              options={LAYOUT_WIDTHS.map((width) => ({
                value: String(width),
                label: `${width} px`,
              }))}
            />
          </Field>
          <Field id="dd-layout-font" label={t("documentDesigner.appearance.font")}>
            <Input
              kind="select"
              id="dd-layout-font"
              name="font"
              value={appearance.font}
              onChange={(value) => {
                const font = LAYOUT_FONTS.find((candidate) => candidate === value);
                if (font !== undefined) patch({ font });
              }}
              display="dropdown"
              options={LAYOUT_FONTS.map((font) => ({
                value: font,
                label: t(`documentDesigner.appearance.font.${font}`),
              }))}
            />
          </Field>
          <Field id="dd-layout-background" label={t("documentDesigner.appearance.background")}>
            <div className="flex items-center gap-2">
              {!backgroundInvalid && <ColorSwatch color={appearance.outerBackground} />}
              <Input
                kind="text"
                id="dd-layout-background"
                name="outerBackground"
                value={appearance.outerBackground}
                onChange={(outerBackground) => patch({ outerBackground })}
                hasError={backgroundInvalid}
              />
            </div>
            {backgroundInvalid && (
              <p role="alert" className="text-xs text-status-bad">
                {t("documentDesigner.appearance.backgroundInvalid")}
              </p>
            )}
          </Field>
          <Field id="dd-layout-accent" label={t("documentDesigner.appearance.accentLine")}>
            <Input
              kind="select"
              id="dd-layout-accent"
              name="accentLine"
              value={appearance.accentLine}
              onChange={(value) => {
                const accentLine = LAYOUT_ACCENT_LINES.find((candidate) => candidate === value);
                if (accentLine !== undefined) patch({ accentLine });
              }}
              display="dropdown"
              options={LAYOUT_ACCENT_LINES.map((accentLine) => ({
                value: accentLine,
                label: t(`documentDesigner.appearance.accentLine.${accentLine}`),
              }))}
            />
          </Field>
          <Field id="dd-layout-button" label={t("documentDesigner.appearance.buttonStyle")}>
            <Input
              kind="select"
              id="dd-layout-button"
              name="buttonStyle"
              value={appearance.buttonStyle}
              onChange={(value) => {
                const buttonStyle = LAYOUT_BUTTON_STYLES.find((candidate) => candidate === value);
                if (buttonStyle !== undefined) patch({ buttonStyle });
              }}
              display="dropdown"
              options={LAYOUT_BUTTON_STYLES.map((buttonStyle) => ({
                value: buttonStyle,
                label: t(`documentDesigner.appearance.buttonStyle.${buttonStyle}`),
              }))}
            />
          </Field>
        </RailField>
      )}
      {!fromMjml && <RailHint>{t("documentDesigner.appearance.fontHint")}</RailHint>}
    </RailSection>
  );
}

export function UsedByRail({
  layoutSlug,
  kind,
  rows,
}: {
  readonly layoutSlug: string;
  readonly kind: LayoutKind;
  readonly rows: readonly OverviewRowView[];
}): ReactNode {
  const t = useTranslation();
  const users = layoutUsers(rows, kind, layoutSlug);
  return (
    <RailSection title={t("documentDesigner.usedBy.title")} testId="document-designer-used-by">
      {users.length === 0 ? (
        <RailHint>{t("documentDesigner.usedBy.none")}</RailHint>
      ) : (
        users.map((row) => (
          <RailRow
            key={row.id}
            testId={`used-by-${row.id}`}
            label={templateTitleText(t, row.title)}
            trailing={
              row.origin === "system"
                ? t("documentDesigner.source.system")
                : statusLabel(t, row.status, row.version)
            }
          />
        ))
      )}
    </RailSection>
  );
}

export function MjmlSourceRail({ mjmlSource }: { readonly mjmlSource: string | null }): ReactNode {
  const t = useTranslation();
  return (
    <RailSection title={t("documentDesigner.mjml.title")} testId="document-designer-mjml-preview">
      {mjmlSource !== null && (
        <pre className="mx-3.5 mt-1 mb-2 max-h-56 overflow-auto whitespace-pre rounded-sm border bg-muted p-2.5 font-mono text-xs text-muted-foreground">
          {mjmlSource}
        </pre>
      )}
      <RailHint>{t("documentDesigner.mjml.hint")}</RailHint>
    </RailSection>
  );
}
