import type { ReactNode } from "react";
import type { Translate } from "../headless/index.ts";
import {
  type DrawerDetailRenderer,
  DrawerHost,
  type useDrawerAction,
} from "./action-form-body.tsx";
import type { FeatureSchema } from "./feature-schema.ts";

export type ProjectionDrawerModel = {
  readonly schema: FeatureSchema;
  readonly translate: Translate | undefined;
  readonly userRoles: Parameters<typeof DrawerHost>[0]["userRoles"];
  readonly drawer: Pick<
    ReturnType<typeof useDrawerAction>,
    | "drawerAction"
    | "drawerScreen"
    | "drawerInitialValues"
    | "drawerRecordId"
    | "drawerHeadingValues"
    | "closeDrawer"
  >;
  readonly refreshRows: () => Promise<void>;
  readonly renderDetail?: DrawerDetailRenderer;
};

export function renderProjectionDrawerHost(model: ProjectionDrawerModel): ReactNode {
  const { schema, translate, userRoles, drawer, refreshRows, renderDetail } = model;
  const {
    drawerAction,
    drawerScreen,
    drawerInitialValues,
    drawerRecordId,
    drawerHeadingValues,
    closeDrawer,
  } = drawer;
  return (
    <DrawerHost
      schema={schema}
      drawerAction={drawerAction}
      drawerScreen={drawerScreen}
      {...(drawerInitialValues !== undefined && { drawerInitialValues })}
      {...(drawerRecordId !== undefined && { drawerRecordId })}
      {...(drawerHeadingValues !== undefined && { drawerHeadingValues })}
      {...(renderDetail !== undefined && { renderDetail })}
      userRoles={userRoles}
      {...(translate !== undefined && { translate })}
      onClose={closeDrawer}
      onSuccess={() => {
        closeDrawer();
        void refreshRows();
      }}
    />
  );
}
