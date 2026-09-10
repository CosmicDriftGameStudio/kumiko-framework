import { consumerCommand as appConsumerCommand } from "@cosmicdrift/kumiko-cli/commands";
import { defineCommand } from "./registry";

export const consumerCommand = defineCommand({
  id: appConsumerCommand.id,
  label: "consumer",
  description: appConsumerCommand.description,
  help: appConsumerCommand.help,
  category: "ops",
  roles: ["maintainer", "app-dev"],
  run: (ctx) => appConsumerCommand.run(ctx),
});
