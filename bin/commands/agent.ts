import { agentCommand as appAgentCommand } from "@cosmicdrift/kumiko-cli/commands";
import { defineCommand } from "./registry";

export const agentCommand = defineCommand({
  id: appAgentCommand.id,
  label: "agent",
  description: appAgentCommand.description,
  help: appAgentCommand.help,
  category: "quality",
  roles: ["maintainer", "app-dev"],
  run: (ctx) => appAgentCommand.run(ctx),
});
