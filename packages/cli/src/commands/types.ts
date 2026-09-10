import type { Output } from "../output";

export type CliCommandContext = {
  readonly argv: ReadonlyArray<string>;
  readonly cwd: string;
  readonly out: Output;
};

export type CliCommand = {
  readonly id: string;
  readonly description: string;
  readonly help: string;
  readonly run: (ctx: CliCommandContext) => Promise<number>;
};
