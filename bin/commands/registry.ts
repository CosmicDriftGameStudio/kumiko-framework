import type { Command, Role } from "./types";

const REGISTRY = new Map<string, Command>();

/** Register a command. Called at module-import-time by each command-file. */
export function defineCommand(cmd: Command): Command {
  if (REGISTRY.has(cmd.id)) {
    throw new Error(`Command "${cmd.id}" already registered`);
  }
  REGISTRY.set(cmd.id, cmd);
  return cmd;
}

/** All commands that apply to the given role, in registration-order. */
export function getCommands(role: Role): ReadonlyArray<Command> {
  return [...REGISTRY.values()].filter((c) => c.roles.includes(role));
}

/** Lookup by id. */
export function getCommand(id: string): Command | undefined {
  return REGISTRY.get(id);
}

/** Test-only: clear the registry. Production code never calls this. */
export function _resetRegistry(): void {
  REGISTRY.clear();
}
