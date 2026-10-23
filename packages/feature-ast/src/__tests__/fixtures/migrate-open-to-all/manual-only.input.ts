import * as z from "zod";

export const listWidgets = {
  name: "widget:list",
  schema: z.object({}),
  description: "Lists all widgets; visible to everyone",
  access: { openToAll: true },
  handler: async () => [],
};

export const legacyPing = {
  name: "legacy:ping",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async () => "pong",
};
