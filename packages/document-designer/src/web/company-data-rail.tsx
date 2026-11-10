import { SessionContext } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { COMPANY_PLACEHOLDERS } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  useAppFeatures,
  useNav,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { toKebab } from "@cosmicdrift/kumiko-types/kebab-case";
import { type ReactNode, useContext } from "react";
import { PLACEHOLDER_SYMBOL } from "./mail-draft.ts";
import { RailHint, RailRow, RailSection } from "./rail.tsx";

const CONFIG_FEATURE_NAME = "config";
const CONFIG_VALUES_QUERY_QN = "config:query:values";
const COMPANY_SETTINGS_SCREEN_ID = "tenant-tenant";
const TENANT_CONFIG_PREFIX = "tenant:config:";

type ConfigValues = Readonly<Record<string, { readonly value?: unknown } | undefined>>;

const COMPANY_CONFIG_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  COMPANY_PLACEHOLDERS.map((name) => [name, `${TENANT_CONFIG_PREFIX}${toKebab(name)}`]),
);

function textValueOf(values: ConfigValues | undefined, name: string): string {
  const key = COMPANY_CONFIG_KEYS[name];
  const value = key === undefined ? undefined : values?.[key]?.value;
  return typeof value === "string" ? value.trim().replace(/\s*\n\s*/g, " · ") : "";
}

// RailRow cannot color its label, and a missing value is a prompt rather than an error.
function MissingValueRow({
  name,
  label,
  trailing,
  onPress,
}: {
  readonly name: string;
  readonly label: string;
  readonly trailing: string;
  readonly onPress: (() => void) | undefined;
}): ReactNode {
  const content = (
    <>
      <span className="min-w-0 grow wrap-anywhere text-sm text-status-warn">{label}</span>
      <span className="shrink-0 text-xs text-primary">{trailing}</span>
    </>
  );
  const rowClass = "flex min-h-10 min-w-0 grow items-center gap-2 px-3.5 text-left";
  return (
    <div className="flex items-center border-b" data-testid={`company-data-${name}`}>
      {onPress === undefined ? (
        <div className={rowClass}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={onPress}
          className={`${rowClass} hover:bg-muted`}
          data-testid={`company-data-${name}-insert`}
        >
          {content}
        </button>
      )}
    </div>
  );
}

export function CompanyDataRail({
  onInsert,
  used,
}: {
  readonly onInsert?: (name: string) => void;
  readonly used?: ReadonlySet<string>;
}): ReactNode {
  const t = useTranslation();
  const nav = useNav();
  const { Link } = usePrimitives();
  const features = useAppFeatures();
  // The designer also renders without an auth provider (tests, embeds): no session, no name.
  const session = useContext(SessionContext);
  const tenantName =
    session?.tenants.find((tenant) => tenant.tenantId === session.activeTenantId)?.name ?? "";
  const configMounted = features.some((feature) => feature.featureName === CONFIG_FEATURE_NAME);
  const hasSettingsScreen = features.some(
    (feature) =>
      feature.featureName === CONFIG_FEATURE_NAME &&
      feature.screens.some((screen) => screen.id === COMPANY_SETTINGS_SCREEN_ID),
  );
  const values = useQuery<ConfigValues>(
    CONFIG_VALUES_QUERY_QN,
    { keys: Object.values(COMPANY_CONFIG_KEYS) },
    { enabled: configMounted },
  );

  const editLink = hasSettingsScreen ? (
    <Link
      href={nav.hrefFor({ screenId: COMPANY_SETTINGS_SCREEN_ID })}
      onPress={() => nav.navigate({ screenId: COMPANY_SETTINGS_SCREEN_ID })}
      testId="company-data-edit"
    >
      {t("documentDesigner.company.edit")}
    </Link>
  ) : undefined;

  return (
    <RailSection
      title={t("documentDesigner.company.title")}
      action={editLink}
      testId="company-data-rail"
    >
      {["tenantName", ...COMPANY_PLACEHOLDERS].map((name) => {
        const text =
          name === "tenantName" ? tenantName : textValueOf(values.data ?? undefined, name);
        const onPress = onInsert === undefined ? undefined : () => onInsert(name);
        if (used === undefined && text === "") {
          return (
            <MissingValueRow
              key={name}
              name={name}
              label={t(`documentDesigner.placeholder.${name}`)}
              trailing={t("documentDesigner.company.enter")}
              onPress={onPress}
            />
          );
        }
        const status =
          used === undefined
            ? { text, tone: "muted" as const }
            : used.has(name)
              ? { text: "✓", tone: "ok" as const }
              : { text: "–", tone: "muted" as const };
        return (
          <RailRow
            key={name}
            testId={`company-data-${name}`}
            {...(used === undefined ? {} : { symbol: PLACEHOLDER_SYMBOL.text })}
            label={t(`documentDesigner.placeholder.${name}`)}
            trailing={status.text}
            trailingTone={status.tone}
            {...(onPress === undefined ? {} : { onPress })}
          />
        );
      })}
      <RailHint>{t("documentDesigner.company.hint")}</RailHint>
    </RailSection>
  );
}
