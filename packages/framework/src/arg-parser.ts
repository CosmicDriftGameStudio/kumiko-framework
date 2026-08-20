// Small arg parser for CLI commands. Not as feature-rich as commander or
// yargs — just:
//   - Positional args:  cmd "value1" "value2"
//   - Flags:            --flag (boolean) / --key value
//   - Negatable:        --no-flag
//
// Copy of bin/commands/arg-parser.ts — registry-free, but upgrade-cli.ts
// lives in the published @cosmicdrift/kumiko-framework package and can't
// import from bin/commands/ (outside the package's export surface).

export type ParsedArgs = {
  readonly positional: ReadonlyArray<string>;
  readonly flags: ReadonlyMap<string, string | boolean>;
};

export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // `--no-foo` form
      if (key.startsWith("no-")) {
        flags.set(key.slice(3), false);
        continue;
      }
      // `--key=value` inline form
      const eq = key.indexOf("=");
      if (eq !== -1) {
        flags.set(key.slice(0, eq), key.slice(eq + 1));
        continue;
      }
      // `--key value` if next isn't a flag, else boolean
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }

  return { positional, flags };
}

export function getFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function getStringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

export function getNumberFlag(args: ParsedArgs, name: string): number | undefined {
  const v = args.flags.get(name);
  if (typeof v !== "string") return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}
