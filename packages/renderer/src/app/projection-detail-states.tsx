import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Translate } from "../headless/index.ts";
import type { usePrimitives } from "../primitives.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import type { NavApi } from "./nav.tsx";
import { lastSegment } from "./qn.ts";
import { QueryErrorBanner } from "./query-state-banners.tsx";
import { navigateToReturnOr, type useReturnTarget } from "./return-to.tsx";
import { findEntityListScreen, RecordNotFoundState } from "./screen-shared.tsx";

type DetailScreen = ProjectionDetailScreenDefinition & { readonly detailFor?: string };

export function renderMissingIdBanner(
  primitives: Pick<ReturnType<typeof usePrimitives>, "Banner" | "Text">,
  screen: DetailScreen,
): ReactNode {
  const { Banner, Text } = primitives;
  return (
    <Banner padded variant="error" testId="kumiko-screen-projection-detail-missing-id">
      Screen <Text variant="code">{screen.id}</Text> (projectionDetail) needs a row id in the path —
      open it from a row action.
    </Banner>
  );
}

export function renderDetailQueryError(
  error: Parameters<typeof QueryErrorBanner>[0]["error"],
  translate: Translate,
  onRetry: () => Promise<void>,
): ReactNode {
  return <QueryErrorBanner error={error} translate={translate} onRetry={onRetry} />;
}

type NotFoundModel = {
  readonly schema: FeatureSchema;
  readonly screen: DetailScreen;
  readonly nav: NavApi;
  readonly returnTarget: ReturnType<typeof useReturnTarget> | undefined;
  readonly effectiveTranslate: Translate;
};

export function renderRecordNotFound(model: NotFoundModel): ReactNode {
  const { schema, screen, nav, returnTarget, effectiveTranslate } = model;
  const backListScreen =
    screen.listScreenId ??
    (screen.detailFor !== undefined
      ? findEntityListScreen(schema, screen.detailFor)?.id
      : undefined);
  return (
    <RecordNotFoundState
      translate={effectiveTranslate}
      {...((returnTarget !== undefined || backListScreen !== undefined) && {
        onBack: () =>
          navigateToReturnOr(nav, returnTarget, () => {
            if (backListScreen !== undefined) {
              nav.navigate({ screenId: lastSegment(backListScreen) });
            }
          }),
      })}
    />
  );
}
