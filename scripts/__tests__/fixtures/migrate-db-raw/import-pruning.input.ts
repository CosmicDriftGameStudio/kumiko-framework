import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { userTable } from "./entities/user";

export const userDetail = defineQueryHandler({
  name: "user:detail",
  handler: async (query, ctx) => {
    const row = await fetchOne<UserRow>(ctx.db.raw, userTable, { id: query.payload.id });
    return row ?? null;
  },
});

export const selectManyHelper = selectMany;
