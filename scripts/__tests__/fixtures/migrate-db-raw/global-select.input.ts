import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { globalFeatureStateTable } from "./entities/global-feature-state";

export async function loadFlags(ctx: Ctx) {
  const rows = await selectMany<FlagRow>(
    ctx.db.raw,
    globalFeatureStateTable,
    { key: "beta" },
    { limit: 10 },
  );
  return rows;
}
