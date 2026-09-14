import { globalFeatureStateTable } from "./entities/global-feature-state";

export async function loadFlags(ctx: Ctx) {
  const rows = await ctx.db.global(globalFeatureStateTable).selectMany<FlagRow>({ key: "beta" }, { limit: 10 });
  return rows;
}
