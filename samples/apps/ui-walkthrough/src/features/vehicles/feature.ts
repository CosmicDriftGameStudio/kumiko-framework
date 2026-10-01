import { defineFeature, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { openToAllSignedIn, toKeyFirst } from "../translations";
import {
  campaignCounterRowSchema,
  campaignExecutor,
  campaignPostExecutor,
  campaignPostRowSchema,
  markPostedPayloadSchema,
} from "./campaign-support";
import { campaignEntity, campaignPostEntity, vehicleEntity } from "./entities";
import { vehiclesTranslations } from "./i18n";
import {
  campaignEditScreen,
  campaignListScreen,
  vehicleEditScreen,
  vehicleListScreen,
  vehicleWizardScreen,
} from "./screens";

export { campaignEntity, campaignPostEntity, vehicleEntity };

const open = openToAllSignedIn(
  "demo app: any signed-in user manages every vehicle; there is no per-user ownership in this sample",
);

export const vehiclesFeature = defineFeature("vehicles", (r) => {
  r.translations({ keys: toKeyFirst(vehiclesTranslations) });

  r.crud("vehicle", vehicleEntity, { write: open, read: open });
  r.crud("campaign", campaignEntity, { write: open, read: open });
  r.crud("campaignPost", campaignPostEntity, { write: open, read: open });

  r.writeHandler(
    "campaign-post:mark-posted",
    markPostedPayloadSchema,
    async (event, ctx) => {
      const current = await campaignPostExecutor.detail(
        { id: event.payload.id },
        event.user,
        ctx.db,
      );
      if (!current) return failNotFound("campaignPost", event.payload.id);
      const post = campaignPostRowSchema.parse(current);

      const marked = await campaignPostExecutor.update(
        { id: post.id, changes: { status: "gepostet" } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
      if (!marked.isSuccess || post.status === "gepostet") return marked;

      const campaign = await campaignExecutor.detail({ id: post.campaign }, event.user, ctx.db);
      if (!campaign) return failNotFound("campaign", post.campaign);
      const { gepostet } = campaignCounterRowSchema.parse(campaign);
      return campaignExecutor.update(
        { id: post.campaign, changes: { gepostet: (gepostet ?? 0) + 1 } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
    },
    open,
  );

  r.screen(vehicleListScreen);
  r.screen(vehicleEditScreen);
  r.screen(vehicleWizardScreen);
  r.screen(campaignListScreen);
  r.screen(campaignEditScreen);

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
