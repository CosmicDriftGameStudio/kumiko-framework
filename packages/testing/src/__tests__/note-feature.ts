import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

const noteEntity = createEntity({
  table: "read_testing_notes",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);

export const NOTE_CREATE = "testing-notes:write:note:create";
export const NOTE_LIST = "testing-notes:query:list";

export const noteFeature = defineFeature("testing-notes", (r) => {
  r.entity("note", noteEntity);
  r.writeHandler(
    defineEntityCreateHandler("note", noteEntity, {
      // SystemAdmin: the seed routes' extraSeeders write as the tenant's system user.
      access: { roles: ["TenantAdmin", "Member", "Reviewer", "SystemAdmin"] },
    }),
  );
  r.queryHandler({
    name: "list",
    schema: z.object({}),
    access: { roles: ["TenantAdmin", "Member", "Reviewer"] },
    handler: async (_query, ctx) => {
      const rows = await selectMany(ctx.db, noteTable);
      return rows.map((row) => String(row["title"]));
    },
  });
});
