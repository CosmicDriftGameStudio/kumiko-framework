import type {
  DashboardStatGroupLink,
  DashboardStatGroupPanel,
  SelectOptionTone,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useNav } from "../../app/nav.tsx";
import { navigateTargetAllows } from "../../app/screen-access.ts";
import type { Translate } from "../../headless/index.ts";
import {
  extensionSectionName,
  useAppFeatures,
  useExtensionSectionComponent,
  usePrimitives,
  useUserRoles,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import "../react-css-custom-properties.ts";
import { STAT_CARD_GRID_CLASSES } from "../widgets/stat.tsx";
import { dashboardNavigationLink } from "./dashboard-navigation-link.ts";
import { StatPanelBody, useStatNavigateAllowed } from "./dashboard-panels.tsx";
import { PanelShell, type ScreenParams } from "./dashboard-shared.tsx";

type StatGroupProps = {
  readonly panel: DashboardStatGroupPanel;
  readonly label: string | undefined;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
};

type StatVariant = "card" | "strip" | "strip-compact";

// Literal class strings: Tailwind only emits classes it can read in the source.
const STAT_CARD_COLUMN_CLASSES = {
  2: "grid grid-cols-1 gap-3 sm:grid-cols-2",
  3: "grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3",
  4: "grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4",
} as const satisfies Record<NonNullable<DashboardStatGroupPanel["columns"]>, string>;

// Literal class strings: Tailwind only emits classes it can read in the source.
const PHONE_STRIP_TONE_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  accent: "max-sm:border-transparent max-sm:bg-primary/10",
  ok: "max-sm:border-transparent max-sm:bg-status-ok-surface",
  warn: "max-sm:border-transparent max-sm:bg-status-warn-surface",
  bad: "max-sm:border-transparent max-sm:bg-status-bad-surface",
  critical: "max-sm:border-transparent max-sm:bg-status-critical-surface",
  neutral: "",
};

function StatGroupLink({
  link,
  translate,
  stretchOnNarrow,
}: {
  readonly link: DashboardStatGroupLink;
  readonly translate: Translate;
  /** Under sm the whole panel row becomes the click target; only the chevron stays visible. */
  readonly stretchOnNarrow: boolean;
}): ReactNode {
  const { Link } = usePrimitives();
  const nav = useNav();
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  if (!navigateTargetAllows({ screen: link.screen }, appFeatures, userRoles)) return null;
  const target = dashboardNavigationLink(nav, link);
  return (
    <Link
      href={target.href}
      onPress={target.onPress}
      testId="dashboard-stat-group-link"
      className={
        stretchOnNarrow
          ? "ml-auto flex shrink-0 items-center gap-1 text-sm font-medium max-sm:after:absolute max-sm:after:inset-0"
          : "ml-auto flex shrink-0 items-center gap-1 text-sm font-medium"
      }
    >
      <span className={stretchOnNarrow ? "max-sm:sr-only" : undefined}>
        {translate(link.label)}
      </span>
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function StatCells({
  panel,
  screenId,
  screenParams,
  translate,
  variant,
}: Omit<StatGroupProps, "label"> & { readonly variant: StatVariant }): ReactNode {
  return panel.stats.map((stat) => (
    <StatPanelBody
      key={stat.id}
      panel={stat}
      label={translate(stat.label)}
      screenId={screenId}
      screenParams={screenParams}
      translate={translate}
      variant={variant}
    />
  ));
}

function FlatStatStrip(props: StatGroupProps): ReactNode {
  const { panel, translate } = props;
  return (
    <div
      data-testid={`dashboard-panel-${panel.id}`}
      className="rounded-lg border border-border bg-card py-1 lg:flex lg:items-center"
    >
      <div className="grid grow grid-cols-2 gap-y-2 lg:auto-cols-fr lg:grid-flow-col lg:divide-x lg:divide-border-row">
        <StatCells {...props} variant="strip" />
      </div>
      {panel.link !== undefined && (
        <div className="flex px-4 max-lg:pt-1 lg:shrink-0">
          <StatGroupLink link={panel.link} translate={translate} stretchOnNarrow={false} />
        </div>
      )}
    </div>
  );
}

function PhoneStripIcon({
  panel,
  screenId,
  screenParams,
}: Pick<StatGroupProps, "panel" | "screenId" | "screenParams">): ReactNode {
  const Icon = useExtensionSectionComponent(
    panel.icon !== undefined ? extensionSectionName(panel.icon) : undefined,
  );
  if (Icon === undefined) return null;
  return (
    <span className="flex shrink-0 items-center self-center sm:hidden">
      <Icon
        entityName={screenId}
        entityId={null}
        screenId={screenId}
        filterParams={screenParams.filterParams}
      />
    </span>
  );
}

function TitledStatStrip(props: StatGroupProps & { readonly label: string }): ReactNode {
  const { panel, label, translate } = props;
  const navigateAllowed = useStatNavigateAllowed();
  const stats = panel.stats.filter(navigateAllowed);
  return (
    <div
      data-testid={`dashboard-panel-${panel.id}`}
      data-narrow-tone={panel.narrow?.tone}
      style={{ "--stat-count": stats.length }}
      className={cn(
        // Board grid: title column, one equal column per stat, link column.
        panel.link === undefined
          ? "sm:[grid-template-columns:190px_repeat(var(--stat-count),minmax(0,1fr))]"
          : "sm:[grid-template-columns:190px_repeat(var(--stat-count),minmax(0,1fr))_auto]",
        "relative flex items-center gap-x-4 rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--card-shadow)] sm:grid sm:gap-x-3 max-sm:items-baseline max-sm:gap-x-2 max-sm:overflow-hidden max-sm:py-2 max-sm:font-medium",
        panel.narrow?.tone !== undefined && PHONE_STRIP_TONE_CLASS[panel.narrow.tone],
      )}
    >
      <PhoneStripIcon panel={panel} screenId={props.screenId} screenParams={props.screenParams} />
      <div className="flex min-w-0 shrink-0 flex-col max-sm:flex-row max-sm:items-baseline">
        <h2 className="text-sm font-semibold max-sm:after:ml-2 max-sm:after:font-normal max-sm:after:text-muted-foreground max-sm:after:content-['·']">
          {label}
        </h2>
        {panel.subtitle !== undefined && (
          <p className="text-xs text-muted-foreground max-sm:hidden">{translate(panel.subtitle)}</p>
        )}
      </div>
      <div className="flex min-w-0 items-stretch gap-3 sm:contents max-sm:block max-sm:grow max-sm:truncate max-sm:text-sm">
        {stats.map((stat) => (
          <div
            key={stat.id}
            className={`flex min-w-0 max-sm:inline max-sm:[&_a]:inline max-sm:[&:not(:last-child)]:after:mx-1.5 max-sm:[&:not(:last-child)]:after:text-muted-foreground max-sm:[&:not(:last-child)]:after:content-['·'] [&>*]:min-w-0${stat.navigate !== undefined ? " max-sm:relative max-sm:z-10" : ""}`}
          >
            <StatPanelBody
              panel={stat}
              label={translate(stat.label)}
              screenId={props.screenId}
              screenParams={props.screenParams}
              translate={translate}
              variant="strip-compact"
            />
          </div>
        ))}
      </div>
      {panel.link !== undefined && (
        <StatGroupLink link={panel.link} translate={translate} stretchOnNarrow />
      )}
    </div>
  );
}

export function StatGroupPanelBody(props: StatGroupProps): ReactNode {
  const { panel, label, translate } = props;
  const layout = panel.layout ?? (label === undefined ? "strip" : "cards");
  if (layout === "strip") {
    return label === undefined ? (
      <FlatStatStrip {...props} />
    ) : (
      <TitledStatStrip {...props} label={label} />
    );
  }
  const cells = (
    <section
      className={
        panel.columns === undefined
          ? STAT_CARD_GRID_CLASSES
          : STAT_CARD_COLUMN_CLASSES[panel.columns]
      }
    >
      <StatCells {...props} variant="card" />
    </section>
  );
  return (
    <PanelShell
      testId={`dashboard-panel-${panel.id}`}
      {...(label !== undefined && { title: label })}
      {...(panel.subtitle !== undefined && { subtitle: translate(panel.subtitle) })}
      {...(panel.link !== undefined && {
        action: <StatGroupLink link={panel.link} translate={translate} stretchOnNarrow={false} />,
      })}
    >
      {cells}
    </PanelShell>
  );
}
