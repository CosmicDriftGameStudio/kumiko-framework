import { DEFAULT_SEED_IF_EXISTS, type SeedIfExists } from "./types";

export type EventStoreSeedExisting = {
  readonly id: string | number;
  readonly version: number;
};

export type RunEventStoreSeedOptions<TExisting extends EventStoreSeedExisting> = {
  readonly existing: TExisting | null | undefined;
  readonly ifExists?: SeedIfExists;
  readonly create: () => Promise<{ id: string | number }>;
  readonly update: (existing: TExisting) => Promise<{ id: string | number }>;
};

/** Shared create-or-skip/update path for event-store boot-seed helpers. */
export async function runEventStoreSeed<TExisting extends EventStoreSeedExisting>(
  opts: RunEventStoreSeedOptions<TExisting>,
): Promise<{ id: string | number }> {
  const ifExists = opts.ifExists ?? DEFAULT_SEED_IF_EXISTS;
  if (opts.existing != null) {
    if (ifExists === "skip") {
      return { id: opts.existing.id };
    }
    return opts.update(opts.existing);
  }
  return opts.create();
}
