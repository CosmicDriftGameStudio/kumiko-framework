import { agentCommand } from "./agent";
import { consumerCommand } from "./consumer";
import { projectCommand } from "./project";
import type { CliCommand } from "./types";

export const APP_COMMANDS: ReadonlyArray<CliCommand> = [
  agentCommand,
  projectCommand,
  consumerCommand,
];

export function findAppCommand(id: string): CliCommand | undefined {
  return APP_COMMANDS.find((c) => c.id === id);
}

export type { CliCommand, CliCommandContext } from "./types";
export { agentCommand, consumerCommand, projectCommand };
