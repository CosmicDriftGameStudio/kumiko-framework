import { agentCommand } from "./agent";
import { checkCommand } from "./check";
import { consumerCommand } from "./consumer";
import { projectCommand } from "./project";
import type { CliCommand } from "./types";

export const APP_COMMANDS: ReadonlyArray<CliCommand> = [
  checkCommand,
  agentCommand,
  projectCommand,
  consumerCommand,
];

export function findAppCommand(id: string): CliCommand | undefined {
  return APP_COMMANDS.find((c) => c.id === id);
}

export {
  type CheckDeps,
  type CheckStep,
  type CheckStepId,
  resolveCheckSteps,
  runCheck,
} from "./check";
export type { CliCommand, CliCommandContext } from "./types";
export { agentCommand, checkCommand, consumerCommand, projectCommand };
