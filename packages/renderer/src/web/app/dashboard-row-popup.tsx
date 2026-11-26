import type { DashboardListPanel } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useCallback, useContext, useMemo } from "react";
import { DrawerHost, type DrawerLikeAction, useDrawerAction } from "../../app/action-form-body.tsx";
import type { FeatureSchema } from "../../app/feature-schema.ts";
import { renderDetailInDrawer } from "../../app/projection-detail-body.tsx";
import { lastSegment } from "../../app/qn.ts";
import type { CellLink, Translate } from "../../headless/index.ts";
import { useAppFeatures, useUserRoles } from "../../index.ts";
import { DashboardQueryContext } from "./dashboard-shared.tsx";

type RowLinkResolver = (row: Readonly<Record<string, unknown>>) => CellLink | undefined;

/** Rows of a `presentation: "popup"` rowLink open their record in a popup; href stays the page for new tab and copy. */
export function useRowLinkPopup(input: {
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly featureName: string;
  readonly translate: Translate;
}): {
  readonly withPopup: (resolve: RowLinkResolver) => RowLinkResolver;
  readonly popupHost: ReactNode;
} {
  const { panel, label, featureName, translate } = input;
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const { refetchAll } = useContext(DashboardQueryContext);
  const schema = useMemo<FeatureSchema>(
    () =>
      appFeatures.find((feature) => feature.featureName === featureName) ?? {
        featureName,
        entities: {},
        screens: [],
      },
    [appFeatures, featureName],
  );
  const { drawerAction, drawerScreen, drawerRecordId, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  const { rowLink } = panel;
  const popupScreen = rowLink?.presentation === "popup" ? rowLink.screen : undefined;
  const popupParamField = rowLink?.presentation === "popup" ? rowLink.paramField : undefined;
  const action = useMemo<DrawerLikeAction | undefined>(
    () =>
      popupScreen === undefined
        ? undefined
        : { kind: "drawer", id: panel.id, label, screen: lastSegment(popupScreen), width: "popup" },
    [popupScreen, panel.id, label],
  );
  const withPopup = useCallback(
    (resolve: RowLinkResolver): RowLinkResolver =>
      (row) => {
        const link = resolve(row);
        if (link === undefined || action === undefined || popupParamField === undefined) {
          return link;
        }
        const entityId = propertyOf(row[popupParamField], "entityId");
        if (typeof entityId !== "string") return link;
        return { href: link.href, onPress: () => openDrawer(action, undefined, entityId) };
      },
    [action, popupParamField, openDrawer],
  );
  const popupHost =
    action === undefined ? null : (
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerRecordId !== undefined && { drawerRecordId })}
        renderDetail={renderDetailInDrawer}
        userRoles={userRoles}
        translate={translate}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void refetchAll();
        }}
      />
    );
  return { withPopup, popupHost };
}
