import type { NavApi } from "../../app/nav.tsx";
import { lastSegment } from "../../app/qn.ts";
import { listNamedFilterUrlKey } from "../../hooks/use-list-url-state.ts";

export type DashboardNavigationTarget = {
  readonly screen: string;
  readonly namedFilter?: string;
  readonly params?: Readonly<Record<string, string>>;
};

export type DashboardNavigationLink = {
  readonly href: string;
  readonly onPress: () => void;
};

// One resolver for stat tiles, list footers and stat-group links, so a namedFilter always lands
// as `<screenId>.filter` and the three never drift.
export function optionalDashboardNavigationLink(
  nav: NavApi,
  navigate: DashboardNavigationTarget | undefined,
): DashboardNavigationLink | undefined {
  return navigate === undefined ? undefined : dashboardNavigationLink(nav, navigate);
}

export function dashboardNavigationLink(
  nav: NavApi,
  navigate: DashboardNavigationTarget,
): DashboardNavigationLink {
  const target = { screenId: lastSegment(navigate.screen) };
  const searchParams: Record<string, string> = {
    ...navigate.params,
    ...(navigate.namedFilter !== undefined && {
      [listNamedFilterUrlKey(target.screenId)]: navigate.namedFilter,
    }),
  };
  const options = Object.keys(searchParams).length === 0 ? undefined : { searchParams };
  return {
    href: nav.hrefFor(target, options),
    onPress: () => nav.navigate(target, options),
  };
}
