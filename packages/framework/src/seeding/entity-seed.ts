import { DEFAULT_SEED_IF_EXISTS, type SeedIfExists } from "./types";

export type EventStoreSeedExisting<TId extends string | number = string> = {
  readonly id: TId;
  readonly version: number;
};

export type RunEventStoreSeedOptions<
  TId extends string | number = string,
  TExisting extends EventStoreSeedExisting<TId> = EventStoreSeedExisting<TId>,
> = {
  readonly existing: TExisting | null | undefined;
  readonly ifExists?: SeedIfExists;
  readonly create: () => Promise<{ id: TId }>;
  readonly update: (existing: TExisting) => Promise<{ id: TId }>;
};

/** Shared create-or-skip/update path for event-store boot-seed helpers. */
export async function runEventStoreSeed<
  TId extends string | number = string,
  TExisting extends EventStoreSeedExisting<TId> = EventStoreSeedExisting<TId>,
>(opts: RunEventStoreSeedOptions<TId, TExisting>): Promise<{ id: TId }> {
  const ifExists = opts.ifExists ?? DEFAULT_SEED_IF_EXISTS;
  if (opts.existing != null) {
    if (ifExists === "skip") {
      return { id: opts.existing.id };
    }
    return opts.update(opts.existing);
  }
  return opts.create();
}
