import { userTable } from "./entities/user";

export const userDetail = defineQueryHandler({
  name: "user:detail",
  handler: async (query, ctx) => {
    const row = await ctx.db.global(userTable).fetchOne<UserRow>({ id: query.payload.id });
    return row ?? null;
  },
});
