import { defineFeature, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { openToAllSignedIn, toKeyFirst } from "../translations";
import { campaignEntity, vehicleEntity } from "./entities";
import { vehiclesTranslations } from "./i18n";
import {
  campaignListScreen,
  vehicleEditScreen,
  vehicleListScreen,
  vehicleWizardScreen,
} from "./screens";

export { campaignEntity, vehicleEntity };

const open = openToAllSignedIn(
  "demo app: any signed-in user manages every vehicle; there is no per-user ownership in this sample",
);

export const vehiclesFeature = defineFeature("vehicles", (r) => {
  r.translations({ keys: toKeyFirst(vehiclesTranslations) });

  r.crud("vehicle", vehicleEntity, { write: open, read: open });
  r.crud("campaign", campaignEntity, { write: open, read: open });

  r.screen(vehicleListScreen);
  r.screen(vehicleEditScreen);
  r.screen(vehicleWizardScreen);
  r.screen(campaignListScreen);

  r.nav({ id: "vehicles", label: i18nKey("vehicles.nav.group"), order: 40 });
  r.nav({
    id: "vehicle-list",
    label: i18nKey("vehicles.nav.list"),
    parent: "vehicles:nav:vehicles",
    screen: "vehicles:screen:vehicle-list",
    order: 10,
  });
  r.nav({
    id: "vehicle-new",
    label: i18nKey("vehicles.nav.new"),
    parent: "vehicles:nav:vehicles",
    screen: "vehicles:screen:vehicle-edit",
    order: 20,
  });
  r.nav({
    id: "campaign-list",
    label: i18nKey("vehicles.nav.campaigns"),
    parent: "vehicles:nav:vehicles",
    screen: "vehicles:screen:campaign-list",
    order: 30,
  });
});
