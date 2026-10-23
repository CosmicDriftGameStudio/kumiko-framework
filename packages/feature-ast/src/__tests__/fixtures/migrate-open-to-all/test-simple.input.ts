import * as z from "zod";

export const listHandler = {
  name: "widget:list",
  schema: z.object({}),
  access: { openToAll: true },
};
