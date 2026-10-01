import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { campaignEntity, campaignPostEntity } from "./entities";

export const { executor: campaignExecutor } = createEntityExecutor("campaign", campaignEntity);
export const { executor: campaignPostExecutor } = createEntityExecutor(
  "campaignPost",
  campaignPostEntity,
);

export const markPostedPayloadSchema = z.object({ id: z.uuid() });

export const campaignPostRowSchema = z.object({
  id: z.string(),
  campaign: z.string(),
  status: z.string(),
});

export const campaignCounterRowSchema = z.object({
  id: z.string(),
  gepostet: z.number().nullish(),
});
