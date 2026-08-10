// Embedded Entity Form Sample
// Shows: RenderEdit hosted in a Drawer with no dedicated screen/route,
// prefilled from an externally-sourced record (a suggestion, not this
// entity's own detail query), controlled mode (onChange + validate-
// without-write via onControlsReady), and a custom write handler instead
// of the built-in CRUD create.
//
// Tables:
//   suggestion — an externally-sourced draft (e.g. an AI extraction),
//                seeded via the standard CRUD create
//   prospect   — created only through `prospect:accept`, which merges the
//                caller's field-level changes onto the suggestion it
//                already knows server-side, stamps provenance the client
//                can't set itself, and flips the suggestion to accepted —
//                one atomic write the built-in CRUD create can't do.

import { createEntityExecutor, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { prospectEntity } from "./entities/prospect";
import { suggestionEntity } from "./entities/suggestion";

export { prospectEntity } from "./entities/prospect";
export { suggestionEntity } from "./entities/suggestion";

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;

const acceptChangesSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  company: z.string().optional(),
  notes: z.string().optional(),
});

export const prospectsFeature = defineFeature("prospects", (r) => {
  r.crud("suggestion", suggestionEntity, { write: adminWrite, read: openRead });
  r.entity("prospect", prospectEntity);

  const { executor: suggestionExecutor } = createEntityExecutor("suggestion", suggestionEntity);
  const { executor: prospectExecutor } = createEntityExecutor("prospect", prospectEntity);

  // Custom handler: the client only ever sends the fields the user actually
  // edited (RenderEdit's onChange `changes`, same delta the controlled mode
  // reports) — the handler owns merging that onto the suggestion it already
  // has, so an untouched field never has to round-trip through the browser.
  r.writeHandler(
    "prospect:accept",
    z.object({ suggestionId: z.uuid(), changes: acceptChangesSchema }),
    async (event, ctx) => {
      const suggestion = await suggestionExecutor.detail(
        { id: event.payload.suggestionId },
        event.user,
        ctx.db,
      );
      if (!suggestion) return failNotFound("suggestion", event.payload.suggestionId);
      if (suggestion["status"] !== "pending") {
        return failUnprocessable("suggestion_already_processed", { status: suggestion["status"] });
      }

      const created = await prospectExecutor.create(
        {
          name: suggestion["name"],
          email: suggestion["email"],
          company: suggestion["company"],
          notes: suggestion["notes"],
          ...event.payload.changes,
          source: `suggestion:${event.payload.suggestionId}`,
          acceptedBy: `user:${event.user.id}`,
          acceptedAt: getTemporal().Now.instant().toString(),
        },
        event.user,
        ctx.db,
      );
      if (!created.isSuccess) return created;

      // Same ctx.db as the create above — one transaction, so a suggestion
      // never ends up "accepted" without a prospect or vice versa.
      const flipped = await suggestionExecutor.update(
        {
          id: event.payload.suggestionId,
          version: suggestion["version"] as number,
          changes: { status: "accepted" },
        },
        event.user,
        ctx.db,
      );
      if (!flipped.isSuccess) return flipped;
      return created;
    },
    adminWrite,
  );

  r.queryHandler(
    "prospect:detail",
    z.object({ id: z.uuid() }),
    async (query, ctx) => prospectExecutor.detail(query.payload, query.user, ctx.db),
    openRead,
  );
});
