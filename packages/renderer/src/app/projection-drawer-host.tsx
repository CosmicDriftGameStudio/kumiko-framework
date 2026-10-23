import type { ReactNode } from "react";
import type { Translate } from "../headless/index.ts";
import { DrawerHost, type useDrawerAction } from "./action-form-body.tsx";
import type { FeatureSchema } from "./feature-schema.ts";

export type ProjectionDrawerModel = {
  readonly schema: FeatureSchema;
  readonly translate: Translate | undefined;
  readonly userRoles: Parameters<typeof DrawerHost>[0]["userRoles"];
  readonly drawer: Pick<
    ReturnType<typeof useDrawerAction>,
    "drawerAction" | "drawerScreen" | "drawerInitialValues" | "closeDrawer"
  >;
  readonly refreshRows: () => Promise<void>;
};

export function renderProjectionDrawerHost(model: ProjectionDrawerModel): ReactNode {
  const { schema, translate, userRoles, drawer, refreshRows } = model;
  const { drawerAction, drawerScreen, drawerInitialValues, closeDrawer } = drawer;
  return (
    <DrawerHost
      schema={schema}
      drawerAction={drawerAction}
      drawerScreen={drawerScreen}
      {...(drawerInitialValues !== undefined && { drawerInitialValues })}
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
