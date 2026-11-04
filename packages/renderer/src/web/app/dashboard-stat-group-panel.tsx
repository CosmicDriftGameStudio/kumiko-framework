import type {
  DashboardStatGroupLink,
  DashboardStatGroupPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useNav } from "../../app/nav.tsx";
import { navigateTargetAllows } from "../../app/screen-access.ts";
import type { Translate } from "../../headless/index.ts";
import { useAppFeatures, usePrimitives, useUserRoles } from "../../index.ts";
import { SectionCard } from "../widgets/section-card.tsx";
import { STAT_CARD_GRID_CLASSES } from "../widgets/stat.tsx";
import { dashboardNavigationLink } from "./dashboard-navigation-link.ts";
import { StatPanelBody } from "./dashboard-panels.tsx";
import type { ScreenParams } from "./dashboard-shared.tsx";

type StatGroupProps = {
  readonly panel: DashboardStatGroupPanel;
  readonly label: string | undefined;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
};

type StatVariant = "card" | "strip" | "strip-compact";

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

function TitledStatStrip(props: StatGroupProps & { readonly label: string }): ReactNode {
  const { panel, label, translate } = props;
  return (
    <div
      data-testid={`dashboard-panel-${panel.id}`}
      className="relative flex items-center gap-x-4 rounded-lg border border-border bg-card px-4 py-2 max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-2 max-sm:gap-y-0.5"
    >
      <div className="flex min-w-0 shrink-0 flex-col max-sm:flex-row max-sm:items-baseline">
        <h2 className="text-sm font-semibold">{label}</h2>
        {panel.subtitle !== undefined && (
          <p className="text-xs text-muted-foreground max-sm:hidden">{translate(panel.subtitle)}</p>
        )}
      </div>
      <div className="flex min-w-0 grow flex-wrap items-center sm:divide-x sm:divide-border-row max-sm:contents">
        {panel.stats.map((stat) => (
          <div
            key={stat.id}
            className={`flex min-w-0 max-sm:items-baseline max-sm:gap-x-2 max-sm:whitespace-nowrap max-sm:[&:not(:last-child)]:after:text-muted-foreground max-sm:[&:not(:last-child)]:after:content-['·']${stat.navigate !== undefined ? " max-sm:relative max-sm:z-10" : ""}`}
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
  return (
    <SectionCard
      {...(label !== undefined && { title: label })}
      {...(panel.subtitle !== undefined && { subtitle: translate(panel.subtitle) })}
      {...(panel.link !== undefined && {
        action: <StatGroupLink link={panel.link} translate={translate} stretchOnNarrow={false} />,
      })}
      testId={`dashboard-panel-${panel.id}`}
    >
      <section className={STAT_CARD_GRID_CLASSES}>
        <StatCells {...props} variant="card" />
      </section>
    </SectionCard>
  );
}
