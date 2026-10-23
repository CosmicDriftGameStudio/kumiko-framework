import * as z from "zod";

export const listHandler = {
  name: "widget:list",
  schema: z.object({}),
  access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
};
