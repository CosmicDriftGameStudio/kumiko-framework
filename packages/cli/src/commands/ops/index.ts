import type { CliCommand, CliCommandContext } from "../types";
import { waitlistMigrateOp } from "./waitlist-migrate";

export type OpsSubcommand = {
  readonly id: string;
  readonly description: string;
  readonly run: (ctx: CliCommandContext) => Promise<number>;
};

export const OPS_SUBCOMMANDS: ReadonlyArray<OpsSubcommand> = [waitlistMigrateOp];

function opsUsage(): string {
  return OPS_SUBCOMMANDS.map((op) => `  ${op.id.padEnd(20)} ${op.description}`).join("\n");
}

export const opsCommand: CliCommand = {
  id: "ops",
  description: "One-off operations on an existing app (waitlist-migrate)",
  help: `Subcommands:\n${opsUsage()}`,
  run: async (ctx) => {
    const sub = OPS_SUBCOMMANDS.find((op) => op.id === ctx.argv[0]);
    if (!sub) {
      ctx.out.err("");
      ctx.out.err("  Usage: kumiko ops <subcommand>");
      ctx.out.err(opsUsage());
      ctx.out.err("");
      return 1;
    }
    return await sub.run({ ...ctx, argv: ctx.argv.slice(1) });
  },
};
