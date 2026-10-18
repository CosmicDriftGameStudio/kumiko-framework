import type { CliCommand, CliCommandContext } from "../types";
import { BACKFILL_PII_HELP, runBackfillPii } from "./backfill-pii";
import { waitlistMigrateOp } from "./waitlist-migrate";

type OpsSubcommand = {
  readonly id: string;
  readonly description: string;
  readonly help: string;
  readonly run: (ctx: CliCommandContext) => Promise<number>;
};

const OPS_SUBCOMMANDS: readonly OpsSubcommand[] = [
  {
    id: "backfill-pii",
    description: "Encrypt pre-KMS plaintext PII in the event store",
    help: BACKFILL_PII_HELP,
    run: runBackfillPii,
  },
  waitlistMigrateOp,
];

function opsUsage(): string {
  return [
    "Usage: kumiko ops <subcommand> [flags]",
    "",
    ...OPS_SUBCOMMANDS.map((sub) => `  ${sub.id.padEnd(16)} ${sub.description}`),
  ].join("\n");
}

export const opsCommand: CliCommand = {
  id: "ops",
  description: "One-off operations against the app database (backfill-pii, waitlist-migrate)",
  // The top-level dispatcher answers any `--help` with this text, so it carries
  // every subcommand's help.
  help: [opsUsage(), ...OPS_SUBCOMMANDS.map((sub) => `\n${sub.id}:\n${sub.help}`)].join("\n"),
  run: async (ctx) => {
    const [subId, ...rest] = ctx.argv;
    const sub = OPS_SUBCOMMANDS.find((candidate) => candidate.id === subId);
    if (sub === undefined) {
      ctx.out.err(opsUsage());
      return 1;
    }
    return sub.run({ ...ctx, argv: rest });
  },
};
