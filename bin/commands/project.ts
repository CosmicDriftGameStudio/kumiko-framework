import { projectCommand as appProjectCommand } from "@cosmicdrift/kumiko-cli/commands";
import { defineCommand } from "./registry";

export const projectCommand = defineCommand({
  id: appProjectCommand.id,
  label: "project",
  description: appProjectCommand.description,
  help: appProjectCommand.help,
  category: "ops",
  roles: ["maintainer", "app-dev"],
  run: (ctx) => appProjectCommand.run(ctx),
});
