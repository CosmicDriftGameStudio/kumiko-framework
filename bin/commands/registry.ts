import type { Command, Role } from "./types";

export type CommandRegistry = {
  /** Register a command. Called at module-import-time by each command-file. */
  defineCommand(cmd: Command): Command;
  /** All commands that apply to the given role, in registration-order. */
  getCommands(role: Role): ReadonlyArray<Command>;
  /** Lookup by id. */
  getCommand(id: string): Command | undefined;
};

export function createCommandRegistry(): CommandRegistry {
  const registry = new Map<string, Command>();
  return {
    defineCommand(cmd) {
      if (registry.has(cmd.id)) {
        throw new Error(`Command "${cmd.id}" already registered`);
      }
      registry.set(cmd.id, cmd);
      return cmd;
    },
    getCommands(role) {
      return [...registry.values()].filter((c) => c.roles.includes(role));
    },
    getCommand(id) {
      return registry.get(id);
    },
  };
}

// Process-wide default registry: command-files register into it at import-time
// via the free `defineCommand`, production reads via `getCommand`/`getCommands`.
// The methods close over their own Map (no `this`), so the free re-exports stay
// bound. Tests must NOT mutate this shared instance — use createCommandRegistry()
// for an isolated one (a test clearing this raced bin/-command readers under the
// concurrent runner).
const defaultRegistry = createCommandRegistry();

export const defineCommand = defaultRegistry.defineCommand;
export const getCommands = defaultRegistry.getCommands;
export const getCommand = defaultRegistry.getCommand;
