// @runtime client
import {
  useAppFeatures,
  useNav,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { DetailList, EmptyState, SectionCard } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { BRANDING_QUERY_QN, BRANDING_SCREEN_QN } from "../constants.js";
import type { BrandingView, LayoutKind, LayoutValidation } from "./layout-types.js";
import { layoutUsers } from "./layout-users.js";
import type { OverviewRowView } from "./overview-row.js";
import { statusLabel } from "./status-label.js";

const NOT_SET_MARK = "–";
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const BRANDING_SCREEN_SHORT_ID = BRANDING_SCREEN_QN.slice(BRANDING_SCREEN_QN.lastIndexOf(":") + 1);

function logoName(logoUrl: string): string {
  const path = logoUrl.split("?")[0] ?? "";
  return path.slice(path.lastIndexOf("/") + 1);
}

function hostOf(siteUrl: string): string {
  return siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function BrandingSwatch({ color }: { readonly color: string }): ReactNode {
  if (!HEX_COLOR.test(color)) return color;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        data-testid="document-designer-accent-swatch"
        className="inline-block size-3.5 rounded-sm border"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono text-xs">{color}</span>
    </span>
  );
}

export function BrandingRail(): ReactNode {
  const t = useTranslation();
  const nav = useNav();
  const features = useAppFeatures();
  const { Link, Text } = usePrimitives();
  const { data, loading, error } = useQuery<BrandingView>(BRANDING_QUERY_QN, {});
  const hasBrandingScreen = features.some(
    (feature) =>
      feature.featureName === "managed-pages" &&
      feature.screens.some((screen) => screen.id === BRANDING_SCREEN_SHORT_ID),
  );
  const notSet = t("documentDesigner.branding.notSet");

  const editLink = hasBrandingScreen ? (
    <Link
      href={nav.hrefFor({ screenId: BRANDING_SCREEN_SHORT_ID })}
      onPress={() => nav.navigate({ screenId: BRANDING_SCREEN_SHORT_ID })}
      testId="document-designer-branding-edit"
    >
      {t("documentDesigner.branding.edit")}
    </Link>
  ) : undefined;

  if (error !== null || (data === null && !loading)) {
    return (
      <SectionCard title={t("documentDesigner.branding.title")} testId="document-designer-branding">
        <EmptyState title={t("documentDesigner.branding.unavailable")} />
      </SectionCard>
    );
  }
  const value = (text: string | undefined): string =>
    text === undefined || text === "" ? notSet : text;
  const logo =
    data?.logoUrl !== undefined && data.logoUrl !== ""
      ? logoName(data.logoUrl)
      : data?.logoFile !== undefined && data.logoFile !== ""
        ? t("documentDesigner.branding.logoUploaded")
        : notSet;
  return (
    <SectionCard
      title={t("documentDesigner.branding.title")}
      action={editLink}
      testId="document-designer-branding"
    >
      <DetailList
        rows={[
          { label: t("documentDesigner.branding.productName"), value: value(data?.title) },
          {
            label: t("documentDesigner.branding.accentColor"),
            value:
              data?.accentColor === undefined || data.accentColor === "" ? (
                notSet
              ) : (
                <BrandingSwatch color={data.accentColor} />
              ),
          },
          { label: t("documentDesigner.branding.logo"), value: logo },
          {
            label: t("documentDesigner.branding.website"),
            value:
              data?.siteUrl === undefined || data.siteUrl === "" ? notSet : hostOf(data.siteUrl),
          },
        ]}
      />
      <Text variant="muted">{t("documentDesigner.branding.hint")}</Text>
    </SectionCard>
  );
}

export function PlaceholderRail({
  validation,
}: {
  readonly validation: LayoutValidation | null;
}): ReactNode {
  const t = useTranslation();
  const used = new Set(validation?.used ?? []);
  const placeholderLabel = (name: string): string => {
    const key = `documentDesigner.placeholder.${name}`;
    const label = t(key);
    return label === key ? name : label;
  };
  return (
    <SectionCard
      title={t("documentDesigner.layoutPlaceholders.title")}
      testId="document-designer-placeholders"
    >
      <DetailList
        rows={[
          {
            label: `${t("documentDesigner.placeholders.content")} *`,
            value: "✓",
          },
          ...(validation?.systemPlaceholders ?? []).map((name) => ({
            id: `placeholder-${name}`,
            label: placeholderLabel(name),
            value: used.has(name) ? "✓" : NOT_SET_MARK,
          })),
        ]}
      />
    </SectionCard>
  );
}

export function AppearanceRail({ kind }: { readonly kind: LayoutKind }): ReactNode {
  const t = useTranslation();
  const { Text } = usePrimitives();
  const rows =
    kind === "mail-layout"
      ? [
          { label: t("documentDesigner.appearance.width"), value: "600 px" },
          {
            label: t("documentDesigner.appearance.font"),
            value: t("documentDesigner.appearance.systemFont"),
          },
          {
            label: t("documentDesigner.appearance.background"),
            value: t("documentDesigner.appearance.backgroundValue"),
          },
        ]
      : [{ label: t("documentDesigner.appearance.pageFormat"), value: "A4" }];
  return (
    <SectionCard
      title={t("documentDesigner.appearance.title")}
      testId="document-designer-appearance"
    >
      <DetailList rows={rows} />
      <Text variant="muted">{t("documentDesigner.appearance.hint")}</Text>
    </SectionCard>
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
    <SectionCard title={t("documentDesigner.usedBy.title")} testId="document-designer-used-by">
      {users.length === 0 ? (
        <EmptyState title={t("documentDesigner.usedBy.none")} />
      ) : (
        <DetailList
          rows={users.map((row) => ({
            id: `used-by-${row.id}`,
            label: row.title,
            value:
              row.origin === "system"
                ? t("documentDesigner.source.system")
                : statusLabel(t, row.status, row.version),
          }))}
        />
      )}
    </SectionCard>
  );
}

export function MjmlPreviewRail({ mjmlSource }: { readonly mjmlSource: string }): ReactNode {
  const t = useTranslation();
  return (
    <SectionCard title={t("documentDesigner.mjml.title")} testId="document-designer-mjml-preview">
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
        {mjmlSource}
      </pre>
    </SectionCard>
  );
}
