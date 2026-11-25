import type { Translate } from "../headless/index.ts";
import { screenFillsHeight } from "../screen-fills-height.ts";
import type { ProjectionDetailScreenWithTarget } from "./projection-detail-states.tsx";

type DetailSections = ProjectionDetailScreenWithTarget["layout"]["sections"];

/** The layout props a projectionDetail hands to RenderEdit, derived from the screen and its active tab. */
export function detailEditLayoutProps(args: {
  readonly screen: ProjectionDetailScreenWithTarget;
  readonly hasTabs: boolean;
  readonly activeSections: DetailSections;
  readonly translate: Translate;
}): {
  readonly footerHint?: string;
  readonly hideSectionTitles?: true;
  readonly recordSections: {
    readonly labelTitles: true;
    readonly omitFirstTitle?: true;
    readonly pageNavigation?: false;
    readonly photosBeside?: true;
  };
  readonly fillScreenHeight?: true;
} {
  const { screen, hasTabs, activeSections, translate } = args;
  return {
    ...(screen.footerHint !== undefined && { footerHint: translate(screen.footerHint) }),
    ...(hasTabs &&
      activeSections.length === 1 &&
      screen.layout.narrowTabs !== false && { hideSectionTitles: true as const }),
    recordSections: {
      labelTitles: true,
      ...(hasTabs &&
        activeSections.length > 1 &&
        activeSections[0]?.tabLabel === undefined && { omitFirstTitle: true as const }),
      ...(screen.pageNavigation === false && { pageNavigation: false as const }),
      ...(screen.photosBeside === true && { photosBeside: true as const }),
    },
    ...(screenFillsHeight(screen) && { fillScreenHeight: true as const }),
  };
}
