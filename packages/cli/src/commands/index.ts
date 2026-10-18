import { agentCommand } from "./agent";
import { checkCommand } from "./check";
import { codemodCommand } from "./codemod";
import { consumerCommand } from "./consumer";
import { handbuchCommand } from "./handbuch";
import { opsCommand } from "./ops";
import { portsCommand } from "./ports";
import { projectCommand } from "./project";
import { syncManagedCommand } from "./sync-managed";
import type { CliCommand } from "./types";

export const APP_COMMANDS: ReadonlyArray<CliCommand> = [
  checkCommand,
  codemodCommand,
  syncManagedCommand,
  portsCommand,
  agentCommand,
  projectCommand,
  consumerCommand,
  handbuchCommand,
  opsCommand,
];

export function findAppCommand(id: string): CliCommand | undefined {
  return APP_COMMANDS.find((c) => c.id === id);
}

export {
  type AppCheckSteps,
  type CheckDeps,
  type CheckStep,
  type CheckStepId,
  resolveCheckSteps,
  runCheck,
} from "./check";
export type { CliCommand, CliCommandContext } from "./types";
export {
  agentCommand,
  checkCommand,
  codemodCommand,
  consumerCommand,
  handbuchCommand,
  opsCommand,
  portsCommand,
  projectCommand,
  syncManagedCommand,
};
